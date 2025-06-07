import angular from "angular";
import React from "react";
import ReactDOM from "react-dom";
import ReactDOMClient from "react-dom/client";

let nextPortalId = 0;

interface Adapter {
  createPortalRoot(target: HTMLElement): ReactDOMClient.Root;
}

interface AugmentedHTMLElement extends HTMLElement {
  __ReactAngularJSAdapter?: Adapter;
}

interface Scope<Props> extends angular.IScope {
  props?: Props;
}

type OnChanges<T> = {
  [K in keyof T]: angular.IChangesObject<T[K]>;
};

/**
 * Wraps an Angular component in React. Returns a new React component.
 *
 * @param componentName The name of the AngularJS component
 * @param component The AngularJS component definition
 * @param $injector The AngularJS `$injector` for the Angular module the component is registered in
 *
 * @example
 * ```jsx
 * const Bar = { bindings: {...}, template: '...', ... };
 *
 * let $injector;
 * angular
 *   .module("foo")
 *   .run(["$injector", (_$injector) => ($injector = _$injector)]);
 *
 * angular
 *   .module('foo', [])
 *   .component('bar', Bar);
 *
 * type Props = {
 *   onChange(value: number): void;
 * }
 *
 * const Bar = angular2react<Props>('bar', Bar, $injector);
 *
 * <Bar onChange={...} />
 * ```
 */
export function angular2react<Props extends Record<string, unknown>>(
  componentName: string,
  component: angular.IComponentOptions,
  $injector: angular.auto.IInjectorService,
): React.FunctionComponent<Props> {
  return function Component(props: Props) {
    const isCompiledRef = React.useRef(false);
    const portalsRef = React.useRef(
      new Map<number, { target: HTMLElement; content: React.ReactNode }>(),
    );
    const [, forceRerender] = React.useReducer((x) => x + 1, 0);

    const scope = React.useMemo<Scope<Props>>(
      () => $injector.get("$rootScope").$new(true),
      [],
    );

    React.useEffect(() => {
      return () => {
        scope.$destroy();
      };
    }, [scope]);

    function digest() {
      scope.props = writable(props);
      scope.$digest();
    }

    // Digest every render
    React.useEffect(digest);

    const bindings: Record<string, unknown> = {};
    if (component.bindings) {
      for (const binding in component.bindings) {
        if (component.bindings[binding].includes("@")) {
          bindings[kebabCase(binding)] = props[binding as keyof Props];
        } else {
          bindings[kebabCase(binding)] = `props.${binding}`;
        }
      }
    }

    function compile(element: HTMLElement) {
      if (isCompiledRef.current) {
        return;
      }

      // Augment the element with the adapter
      (element as AugmentedHTMLElement).__ReactAngularJSAdapter = {
        createPortalRoot(target) {
          const id = nextPortalId++;
          return {
            render(content) {
              portalsRef.current.set(id, { target, content });
              forceRerender();
            },
            unmount() {
              portalsRef.current.delete(id);
              forceRerender();
            },
          };
        },
      };

      $injector.get("$compile")(element)(scope);
      isCompiledRef.current = true;
      digest();
    }

    return [
      React.createElement(kebabCase(componentName), {
        ...bindings,
        ref: compile,
        key: componentName,
      }),
      ...Array.from(portalsRef.current.entries()).map(
        ([key, { content, target }]) =>
          ReactDOM.createPortal(content, target, key),
      ),
    ];
  };
}

/**
 * Wraps a React component in Angular. Returns a new Angular component.
 *
 * @param Component The React component to wrap
 * @param bindingNames The bindings for the component, which will be passed as props
 * @param injectNames Any AngularJS dependencies that should be injected as props to the component
 *
 * @example
 * ```tsx
 * interface Props {
 *   foo: number;
 *   $location: angular.ILocationService;
 * }
 *
 * function ReactComponent(props: Props) {
 *   return (
 *     <div>
 *       foo: {props.foo}. Location: {props.$location.absUrl()}
 *     </div>
 *   );
 * }
 *
 * const angularComponent = react2angular(ReactComponent, ['foo'], ["$location"]);
 * ```
 */
export function react2angular<Props extends object>(
  Component: React.ComponentType<Props>,
  bindingNames: (keyof Props)[],
  injectNames: (keyof Props)[] = [],
): angular.IComponentOptions {
  return {
    bindings: Object.fromEntries(bindingNames.map((_) => [_, "<"])),
    controller: [
      "$element",
      ...(injectNames as string[]),
      class implements angular.IController {
        static $$ngIsClass = true;

        private element: HTMLElement;
        private root: ReactDOMClient.Root;
        private injectedProps: Partial<Props>;

        public props = {} as Partial<Props>;

        constructor(
          $element: angular.IAugmentedJQuery,
          ...services: unknown[]
        ) {
          this.element = $element[0];

          this.injectedProps = {};
          injectNames.forEach((name, i) => {
            this.injectedProps[name] = services[i] as Props[keyof Props];
          });

          let reactAncestor: AugmentedHTMLElement | null = this.element;
          while (reactAncestor && !reactAncestor.__ReactAngularJSAdapter) {
            reactAncestor = reactAncestor.parentElement;
          }

          if (reactAncestor?.__ReactAngularJSAdapter) {
            this.root = reactAncestor.__ReactAngularJSAdapter.createPortalRoot(
              this.element,
            );
          } else {
            this.root = ReactDOMClient.createRoot(this.element);
          }
        }

        public $onInit() {
          bindingNames.forEach((name) => {
            (this.props as Record<keyof Props, unknown>)[name] =
              this[name as keyof this];
          });
        }

        public $onChanges(changes: OnChanges<Partial<Props>>) {
          const newProps = {} as Partial<Props>;
          for (const k of Object.keys(changes)) {
            newProps[k as keyof Props] =
              changes[k as keyof Props]?.currentValue;
          }

          const nextProps = { ...this.props, ...newProps };
          this.props = nextProps;

          const reactElement = React.createElement(Component, {
            ...this.props,
            ...this.injectedProps,
          } as Props);
          this.root.render(reactElement);
        }

        public $onDestroy() {
          this.root.unmount();
        }
      },
    ],
  };
}

/**
 * Angular may try to bind back a value via 2-way binding, but React marks all properties on `props`
 * as non-configurable and non-writable.
 *
 * If we use a `Proxy` to intercept writes to these non-writable properties, we run into an issue
 * where the proxy throws when trying to write anyway, even if we `return false`.
 *
 * Instead, we use the below ad-hoc proxy to catch writes to non-writable properties in `object`,
 * and log a helpful warning when it happens.
 */
function writable<T extends object>(object: T): T {
  const _object = {} as T;
  for (const key in object) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      Object.defineProperty(_object, key, {
        get() {
          return object[key];
        },
        set(value: unknown) {
          const d = Object.getOwnPropertyDescriptor(object, key);
          if (d?.writable) {
            object[key] = value as T[typeof key];
            return;
          } else {
            console.warn(
              `Tried to write to non-writable property "${key}" of`,
              object,
              `. Consider using a callback instead of 2-way binding.`,
            );
          }
        },
      });
    }
  }
  return _object;
}

function kebabCase(str: string) {
  return (
    str
      // Replace non-alphanumeric characters with dashes
      .replace(/[^A-Za-z0-9]/g, "-")

      // Add dashes around number groups
      .replace(/([0-9]+)/g, "-$1-")

      // Add dashes before capitals, preserve groups of capitals (except last)
      .replace(/([A-Z]*)([A-Z-]|$)/g, "-$1-$2")

      // Replace multiple dashes with a single dash
      .replace(/-+/g, "-")

      // Strip dash from start and end
      .replace(/(^-|-$)/g, "")

      // Convert it all to lowercase
      .toLowerCase()
  );
}

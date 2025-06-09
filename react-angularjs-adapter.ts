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

    const scope = React.useMemo<Scope<Props>>(() => $injector.get("$rootScope").$new(true), []);

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
      ...Array.from(portalsRef.current.entries()).map(([key, { content, target }]) =>
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

        public constructor($element: angular.IAugmentedJQuery, ...services: unknown[]) {
          this.element = $element[0];

          this.injectedProps = {};
          injectNames.forEach((name, i) => {
            this.injectedProps[name] = services[i] as Props[keyof Props];
          });

          // Search through the element ancestors for am angular2react element we can portal from
          let reactAncestor: AugmentedHTMLElement | null = this.element;
          while (reactAncestor && !reactAncestor.__ReactAngularJSAdapter) {
            reactAncestor = reactAncestor.parentElement;
          }

          if (reactAncestor?.__ReactAngularJSAdapter) {
            this.root = reactAncestor.__ReactAngularJSAdapter.createPortalRoot(this.element);
          } else {
            this.root = ReactDOMClient.createRoot(this.element);
          }
        }

        public $onChanges(changes: OnChanges<Partial<Props>>) {
          const newProps = {} as Partial<Props>;
          for (const k of Object.keys(changes)) {
            newProps[k as keyof Props] = changes[k as keyof Props]?.currentValue;
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
              `react-angularjs-adapter: Tried to write to non-writable property "${key}" of`,
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

/**
 * Convert a camelCase string to kebab-case. Logs an error if the given string contains invalid
 * characters.
 *
 * Assuming none of the error conditions are hit, this function should generate a kebab-case string
 * which AngularJS will convert back into the source string.
 *
 * AngularJS converts from kebab-case to camelCase following the rules here:
 * https://docs.angularjs.org/guide/directive#matching-directives
 *
 * You can see the actual code AngularJS uses here:
 * https://github.com/angular/code.angularjs.org/blob/master/1.8.3/angular.js#L11576
 *
 * The valid characters are [a-zA-Z0-9] because those are the characters AngularJS allows in
 * identifiers: https://github.com/angular/code.angularjs.org/blob/master/1.8.3/angular.js#L15844
 */
function kebabCase(str: string) {
  if (!LOWERCASE_START.test(str)) {
    throw new Error(
      `react-angularjs-adapter: Cannot convert "${str}" to kebab-case because it does not start with a lowercase letter!`,
    );
  }

  if (INVALID_CHARACTERS.test(str)) {
    throw new Error(
      `react-angularjs-adapter: Cannot convert "${str}" to kebab-case because it contains characters outside the range [a-zA-Z0-9]!`,
    );
  }

  return str.replace(CAMEL_TO_KEBAB_REGEXP, (letter) => "-" + letter.toLowerCase());
}

const LOWERCASE_START = /^[a-z]/;
const INVALID_CHARACTERS = /[^a-zA-Z0-9]/g;
const CAMEL_TO_KEBAB_REGEXP = /[A-Z]/g;

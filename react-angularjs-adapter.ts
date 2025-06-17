import angular from "angular";
import React from "react";
import ReactDOM from "react-dom";
import ReactDOMClient from "react-dom/client";

const LOWERCASE_START = /^[a-z]/;
const INVALID_CHARACTERS = /[^a-zA-Z0-9]/g;
const CAMEL_TO_KEBAB_REGEXP = /[A-Z]/g;
const VALID_BINDINGS = /[@<]/;

let nextPortalId = 0;
let $defaultInjector: angular.auto.IInjectorService | undefined;

/**
 * Set an $injector to use by default for the `angular2react` function
 */
export function setDefaultInjector($injector: angular.auto.IInjectorService | undefined) {
  $defaultInjector = $injector;
}

interface Adapter<Props> {
  createPortalRoot(target: HTMLElement): ReactDOMClient.Root;
  $scope: angular.IScope & { props?: Props };
}

interface AugmentedHTMLElement<Props> extends HTMLElement {
  __ReactAngularJSAdapter: Adapter<Props>;
}

function isAugmented(element: HTMLElement | null): element is AugmentedHTMLElement<unknown> {
  return element !== null && "__ReactAngularJSAdapter" in element;
}

function logWarning(...messages: unknown[]) {
  console.warn("react-angularjs-adapter:", ...messages);
}

export class ReactAngularJSAdapterError extends Error {
  constructor(message: string) {
    super(`react-angularjs-adapter: ${message}`);
  }
}

type OnChanges<T> = {
  [K in keyof T]: angular.IChangesObject<T[K]>;
};

/**
 * Wraps an AngularJS component in React. Returns a new React component.
 *
 * @param componentName The name of the AngularJS component
 * @param component The AngularJS component definition
 * @param $injector The AngularJS `$injector` for the application the component is registered in.
 *                  You can omit this if you have used the `setDefaultInjector` function to set a
 *                  default injector.
 *
 * @example
 * ```tsx
 * import { angular2react, setDefaultInjector } from "react-angularjs-adapter"
 *
 * const angularComponent = {
 *   bindings: { fooBar: '<', baz: '<' },
 *   template: "<p>FooBar: {this.$ctrl.fooBar}</p><p>Baz: {this.$ctrl.baz}</p>"
 * }
 *
 * angular
 *   .module("myModule", [])
 *   .component("angularComponent", angularComponent)
 *
 * // Set the default injector for angular2react. This only needs to be done once.
 * angular.module("myModule").run(["$injector", setDefaultInjector]);
 *
 * // Define the Prop types based on the component's bindings
 * interface Props {
 *   fooBar: number;
 *   baz: string;
 * }
 *
 * // Create the React component
 * const ReactComponent = angular2react<Props>('angularComponent', angularComponent, $injector);
 *
 * // Then in your JSX:
 * <ReactComponent fooBar={42} baz='lorem ipsum' />
 * ```
 */
export function angular2react<Props extends object = Record<string, unknown>>(
  componentName: string,
  component: angular.IComponentOptions,
  $injector?: angular.auto.IInjectorService,
): React.FunctionComponent<Props> {
  function getInjector() {
    if (typeof $injector !== "undefined") {
      return $injector;
    }
    if (typeof $defaultInjector === "undefined") {
      throw new ReactAngularJSAdapterError(
        "$injector is unset. Please pass an $injector to the angular2react function, or use the setDefaultInjector function to set a default one.",
      );
    }
    return $defaultInjector;
  }

  return function Component(props: Props) {
    const elementRef = React.useRef<AugmentedHTMLElement<Props>>(null);
    const portalsRef = React.useRef(
      new Map<number, { target: HTMLElement; content: React.ReactNode }>(),
    );
    const [, forceRerender] = React.useReducer((x) => x + 1, 0);

    const bindings = React.useMemo<Record<string, string>>(() => {
      if (!component.bindings) {
        return {};
      }

      if (Object.values(component.bindings).some((b) => !VALID_BINDINGS.test(b))) {
        logWarning(
          `${componentName} has '=' or '&' bindings which will not work properly with React:`,
          component.bindings,
        );
      }

      return Object.fromEntries(
        Object.entries(component.bindings).map(([property, binding]) => [
          kebabCase(property),
          binding.includes("@") ? `{{props.${property}}}` : `props.${property}`,
        ]),
      );
    }, []);

    React.useEffect(() => {
      // Apply bindings as attributes to the element. We do this here instead of just setting them
      // as props so that we can ensure they are the correct values. As an example of when they
      // could be incorrect: in React strict mode during development, this Effect is run twice, so
      // the element may have already had AngularJS set up and destroyed on it. This would cause
      // interpolated strings in the attributes (which we use for '@' bindings) to be updated
      // to their resolved string values, which would cause those bindings to no longer respond to
      // changes. So to avoid issues like that, we set the attributes immediately before compiling.
      for (const [key, value] of Object.entries(bindings)) {
        elementRef.current!.setAttribute(key, value);
      }

      const $injector = getInjector();

      // Set up new scope for the element
      const $scope = $injector.get("$rootScope").$new(true);

      // Augment the element with our adapter object
      (elementRef.current as AugmentedHTMLElement<Props>).__ReactAngularJSAdapter = {
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
        $scope,
      };

      // Finally, compile the element with our scope
      $injector.get("$compile")(elementRef.current!)($scope);

      // Destroy scope on unmount
      return () => {
        $scope.$destroy();
      };
    }, []);

    React.useEffect(() => {
      // Update scope and digest after every render
      if (elementRef.current) {
        elementRef.current.__ReactAngularJSAdapter.$scope.props = writable(props);
        elementRef.current.__ReactAngularJSAdapter.$scope.$digest();
      }
    });

    return [
      React.createElement(kebabCase(componentName), {
        ref: elementRef,
        key: componentName,
      }),
      ...Array.from(portalsRef.current.entries()).map(([key, { content, target }]) =>
        ReactDOM.createPortal(content, target, key),
      ),
    ];
  };
}

/**
 * Wraps a React component in AngularJS. Returns a new AngularJS component.
 *
 * @param Component The React component to wrap
 * @param bindingNames The bindings for the component, which will be passed as props
 * @param injectNames Any AngularJS dependencies that should be injected as props to the component
 *
 * @example
 * ```tsx
 * // Define a React component
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
 * // Convert it to an AngularJS component
 * const angularComponent = react2angular(ReactComponent, ['foo'], ["$location"]);
 * angular.module("myModule", []).component("angularComponent", angularComponent);
 *
 * // Then in your HTML
 * <angular-component foo-bar="42" baz="'lorem ipsum'"></angular-component>
 * ```
 */
export function react2angular<Props extends object>(
  Component: React.ComponentType<Props>,
  bindingNames: (keyof Props)[] = [],
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

          // Search through the element ancestors for an angular2react element we can portal from
          let reactAncestor: HTMLElement | null = this.element;
          while (reactAncestor && !isAugmented(reactAncestor)) {
            reactAncestor = reactAncestor.parentElement;
          }

          if (isAugmented(reactAncestor)) {
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
 * AngularJS may try to bind back a value via 2-way binding, but React marks all properties on
 * `props` as non-configurable and non-writable.
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
            logWarning(
              `Tried to write to non-writable property "${key}" of`,
              object,
              `. Consider using a callback instead of a 2-way binding.`,
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
    throw new ReactAngularJSAdapterError(
      `Cannot convert "${str}" to kebab-case because it does not start with a lowercase letter`,
    );
  }

  if (INVALID_CHARACTERS.test(str)) {
    throw new ReactAngularJSAdapterError(
      `Cannot convert "${str}" to kebab-case because it contains characters outside the range [a-zA-Z0-9]`,
    );
  }

  return str.replace(CAMEL_TO_KEBAB_REGEXP, (letter) => "-" + letter.toLowerCase());
}

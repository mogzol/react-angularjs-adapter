/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it, beforeEach, afterEach, after } from "node:test";
import jsdom from "jsdom";
import type angularType from "angular";
import React, { createContext, useContext } from "react";
import ReactDOMClient from "react-dom/client";

import { angular2react, react2angular, setDefaultInjector } from "./react-angularjs-adapter.js";

type Global = Record<string, unknown>;

function ReactRenderWatcher(props: React.PropsWithChildren<{ onRendered(): void }>) {
  const rendersRef = React.useRef(0);
  React.useEffect(() => {
    // In strict mode, the effect will be called twice on mount, so ignore the first one
    if (rendersRef.current > 0) {
      props.onRendered();
    }
    rendersRef.current++;
  });
  return props.children;
}

/** Render a React component in strict mode, and wait for it to finish before returning */
async function renderReact(root: ReactDOMClient.Root, children: React.ReactNode) {
  let onRendered = () => {};
  const renderPromise = new Promise<void>((r) => (onRendered = r));
  const watcherElement = React.createElement(ReactRenderWatcher, { onRendered }, children);
  root.render(React.createElement(React.StrictMode, {}, watcherElement));
  await renderPromise;
}

describe("react-angularjs-adapter", () => {
  let angular: typeof angularType;

  function bootstrapAngular(
    ...components: [string, angularType.IComponentOptions][]
  ): [
    angularType.auto.IInjectorService,
    angularType.ICompileService,
    angularType.IRootScopeService,
  ] {
    const module = angular.module("test-app", []);
    for (const [name, component] of components) {
      module.component(name, component);
    }

    const $injector = angular.bootstrap(document.documentElement, ["test-app"]);
    const $compile = $injector.get("$compile");
    const $rootScope = $injector.get("$rootScope");

    return [$injector, $compile, $rootScope];
  }

  beforeEach(() => {
    const dom = new jsdom.JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
      url: "http://localhost/test",
    });
    const window = dom.window;
    const document = window.document;
    (global as Global).window = window;
    (global as Global).document = document;

    const angularPath = path.resolve(import.meta.dirname, "node_modules/angular/angular.js");
    const angularCode = fs.readFileSync(angularPath, "utf-8");
    window.eval(angularCode);
    angular = window.angular as typeof angularType;
  });

  afterEach(() => {
    delete (global as Global).window;
    delete (global as Global).document;
  });

  describe("react2angular", () => {
    it("should mount and update a React component in AngularJS", async () => {
      // Create a wrapper angular component which passes values to and updates the React component
      const Wrapper = {
        template: `<test-component string="$ctrl.string" number="$ctrl.number" date="$ctrl.date" ng-click="$ctrl.update()"></test-component>`,
        bindings: { foo: "@" },
        controller: function () {
          const $ctrl = this as Record<string, unknown>;
          $ctrl.string = "Hello, World!";
          $ctrl.number = 42;
          $ctrl.date = new Date(1234567891011);
          $ctrl.update = () => {
            $ctrl.string = "updated :)";
            $ctrl.number = -21;
            $ctrl.date = new Date(1110987654321);
          };
        },
      };

      // Create a React component with a variety of props to test passing different types
      const TestComponent = (props: {
        string: string;
        number: number;
        date: Date;
        $location: angularType.ILocationService;
      }) =>
        React.createElement(
          "div",
          null,
          [
            `${typeof props.string}: ${props.string}`,
            `${typeof props.number}: ${props.number}`,
            `${typeof props.date}: ${props.date.toISOString()}`,
            `location: ${props.$location.absUrl()}`,
          ].join(),
        );

      // Convert it to an angular component
      const ngComponent = react2angular(TestComponent, ["string", "number", "date"], ["$location"]);

      // Bootstrap angular and render the components
      const [, $compile, $rootScope] = bootstrapAngular(
        ["wrapper", Wrapper],
        ["testComponent", ngComponent],
      );
      const el = angular.element(`<wrapper></wrapper>`);
      const compiled = $compile(el)($rootScope);
      $rootScope.$digest();

      // Wait a bit for React to render
      await new Promise((r) => setTimeout(r, 100));

      // Check that the rendered component has the expected text
      assert.equal(
        compiled.text(),
        [
          "string: Hello, World!",
          `number: 42`,
          `object: 2009-02-13T23:31:31.011Z`,
          `location: http://localhost/test`,
        ].join(),
        "Component should have the expected values",
      );

      // Simulate a click to update the component
      (compiled[0].firstElementChild as HTMLElement).click();

      // Wait a bit for React to render
      await new Promise((r) => setTimeout(r, 100));

      assert.equal(
        compiled.text(),
        [
          "string: updated :)",
          `number: -21`,
          `object: 2005-03-16T15:40:54.321Z`,
          `location: http://localhost/test`,
        ].join(),
        "Component should update when bindings change",
      );
    });

    it("should mount multiple React components in AngularJS at the same time", async () => {
      const TestComponent = (props: { label: string }) =>
        React.createElement("div", { className: "react-label" }, props.label);
      const ngComponent = react2angular(TestComponent, ["label"]);

      const Wrapper = {
        template: `<test-component label="'A'"></test-component><test-component label="'B'"></test-component>`,
      };

      const [, $compile, $rootScope] = bootstrapAngular(
        ["testComponent", ngComponent],
        ["wrapper", Wrapper],
      );
      const el = angular.element(`<wrapper></wrapper>`);
      const compiled = $compile(el)($rootScope);
      $rootScope.$digest();
      await new Promise((r) => setTimeout(r, 100));
      const labels = compiled[0].querySelectorAll(".react-label");
      assert.equal(labels.length, 2, "Should render two React components");
      assert.equal(labels[0].textContent, "A");
      assert.equal(labels[1].textContent, "B");
    });
  });

  describe("angular2react", () => {
    it("should mount and update an AngularJS component in React", async () => {
      // Define an AngularJS component
      const TestComponent = {
        bindings: { foo: "<", onBar: "<", baz: "@" },
        template: `<div class="ng-comp">{{$ctrl.foo}}<button ng-click="$ctrl.onBar()"> </button>{{$ctrl.baz}}</div>`,
        controller: function () {},
      };

      // Bootstrap AngularJS with the component
      const [$injector] = bootstrapAngular(["testComponent", TestComponent]);

      // Create a React wrapper for the AngularJS component
      const ReactTestComponent = angular2react<{ foo: string; onBar: () => void; baz: string }>(
        "testComponent",
        TestComponent,
        $injector,
      );

      // Mount the React component
      let barCalled = false;
      const onBar = () => {
        barCalled = true;
      };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await renderReact(
        root,
        React.createElement(ReactTestComponent, { foo: "hello!", onBar, baz: "world." }),
      );

      // Wait for AngularJS digest/render
      await new Promise((r) => setTimeout(r, 100));
      const div = container.querySelector(".ng-comp");
      assert(div, "AngularJS component should be rendered");
      assert.equal(div.textContent, "hello! world.", "Component should contain the expected text");

      // Update props
      await renderReact(
        root,
        React.createElement(ReactTestComponent, { foo: "updated!", onBar, baz: "me too :)" }),
      );
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(
        div.textContent,
        "updated! me too :)",
        "Component should update when props change",
      );

      // Simulate click
      const button = div.querySelector("button");
      assert(button, "Button should exist");
      button.click();
      await new Promise((r) => setTimeout(r, 10));
      assert(barCalled, "onBar callback should be called");
    });

    it("should mount multiple AngularJS components in React at the same time", async () => {
      const TestComponent = {
        bindings: { label: "<" },
        template: `<div class="ng-label">{{$ctrl.label}}</div>`,
        controller: function () {},
      };
      const [$injector] = bootstrapAngular(["testComponent", TestComponent]);
      const ReactTestComponent = angular2react<{ label: string }>(
        "testComponent",
        TestComponent,
        $injector,
      );
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await renderReact(
        root,
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ReactTestComponent, { label: "X" }),
          React.createElement(ReactTestComponent, { label: "Y" }),
        ),
      );
      await new Promise((r) => setTimeout(r, 100));

      const labels = container.querySelectorAll(".ng-label");
      assert.equal(labels.length, 2, "Should render two AngularJS components");
      assert.equal(labels[0].textContent, "X");
      assert.equal(labels[1].textContent, "Y");
    });

    it("should convert attributes to kebab-case in the form AngularJS expects", async () => {
      const testProps = {
        normalCamelCase: "test-data-1",
        someABCProp: "test-data-2",
        componentABC: "test-data-3",
        number123Component: "test-data-4",
        number123: "test-data-5",
        some1TEST55something: "test-data-6",
      };
      const TestComponent = {
        bindings: Object.fromEntries(Object.keys(testProps).map((k) => [k, "<"])),
        template: `<span ng-repeat="(key, value) in $ctrl">{{ key }}:{{ value }},</span>`,
        controller: function () {},
      };
      const [$injector] = bootstrapAngular(["testComponent", TestComponent]);
      const ReactTestComponent = angular2react("testComponent", TestComponent, $injector);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await renderReact(root, React.createElement(ReactTestComponent, testProps));
      await new Promise((r) => setTimeout(r, 100));

      const allText = container.textContent;
      assert(allText, "Should render text");
      const resultProps = Object.fromEntries(
        allText
          .split(",")
          .filter((t) => t)
          .map((t) => t.split(":")) as [string, string][],
      );

      assert.deepStrictEqual(
        resultProps,
        testProps,
        `Rendered component did not correctly pass all props as attributes.\n\nRendered element:\n\n${container.innerHTML}\n\n`,
      );
    });

    it("should allow setting a default injector with setDefaultInjector", async () => {
      const TestComponent = {
        bindings: { label: "<" },
        template: `<div class="ng-label">{{$ctrl.label}}</div>`,
        controller: function () {},
      };

      // When not passing $injector, this can be called before bootstrapping angular
      const ReactTestComponent = angular2react<{ label: string }>("testComponent", TestComponent);

      const [$injector] = bootstrapAngular(["testComponent", TestComponent]);
      setDefaultInjector($injector);
      after(() => setDefaultInjector(undefined));

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await renderReact(root, React.createElement(ReactTestComponent, { label: "X" }));
      await new Promise((r) => setTimeout(r, 100));

      const labels = container.querySelectorAll(".ng-label");
      assert.equal(labels.length, 1, "Should render components with the default injector");
      assert.equal(labels[0].textContent, "X");
    });

    it("should throw if the default injector is unset and none is passed", async () => {
      const TestComponent = {
        bindings: { label: "<" },
        template: `<div class="ng-label">{{$ctrl.label}}</div>`,
        controller: function () {},
      };
      bootstrapAngular(["testComponent", TestComponent]);

      const ReactTestComponent = angular2react<{ label: string }>("testComponent", TestComponent);

      let renderError: unknown;
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container, {
        onUncaughtError: (e) => (renderError = e),
      });

      await renderReact(root, React.createElement(ReactTestComponent, { label: "X" }));
      await new Promise((r) => setTimeout(r, 100));

      assert.match(
        String(renderError),
        /\$injector is unset/,
        "should throw if no $injector is provided",
      );
    });
  });

  describe("contexts", () => {
    it("should pass React context through AngularJS components", async () => {
      // Create a React context
      const MyContext = createContext("default value");

      // React component that reads from context
      const ContextReader = () => {
        const value = useContext(MyContext);
        return React.createElement("div", { className: "context-value" }, value);
      };

      // Wrap ContextReader in AngularJS
      const NgContextReader = react2angular(ContextReader, []);

      // AngularJS component that renders the React-wrapped component
      const NgWrapper = {
        template: `<ng-context-reader></ng-context-reader>`,
      };

      // Bootstrap AngularJS
      const [$injector] = bootstrapAngular(
        ["ngContextReader", NgContextReader],
        ["ngWrapper", NgWrapper],
      );

      // Wrap the AngularJS component in React
      const ReactNgWrapper = angular2react("ngWrapper", NgWrapper, $injector);

      // Mount the React context provider -> AngularJS -> React context consumer
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await renderReact(
        root,
        React.createElement(
          MyContext.Provider,
          { value: "context works!" },
          React.createElement(ReactNgWrapper, {}),
        ),
      );

      // Wait for AngularJS to render
      await new Promise((r) => setTimeout(r, 100));

      const div = container.querySelector(".context-value");
      assert(div, "ContextReader should be rendered");
      assert.equal(div.textContent, "context works!");
    });

    it("should pass React context through multiple levels of React/AngularJS components", async () => {
      const MyContext = createContext("default value");

      // Set up components which will be rendered like:
      //   ReactRoot -> NgFirstLevel -> ReactFirstLevel -> NgSecondLevel -> ReactSecondLevel
      // The React context is provided in ReactRoot, and read in ReactSecondLevel.

      const ReactFirstLevel = () => {
        return React.createElement(ReactNgSecondLevel);
      };
      const NgReactFirstLevel = react2angular(ReactFirstLevel);
      const ReactSecondLevel = () => {
        const value = useContext(MyContext);
        return React.createElement("div", { className: "context-value" }, value);
      };
      const NgReactSecondLevel = react2angular(ReactSecondLevel);

      const NgSecondLevel = {
        template: `<ng-react-second-level></ng-react-second-level>`,
      };
      const NgFirstLevel = {
        template: `<ng-react-first-level></ng-react-first-level>`,
      };

      const [$injector] = bootstrapAngular(
        ["ngFirstLevel", NgFirstLevel],
        ["ngSecondLevel", NgSecondLevel],
        ["ngReactFirstLevel", NgReactFirstLevel],
        ["ngReactSecondLevel", NgReactSecondLevel],
      );

      // Wrap the AngularJS components in React
      const ReactNgFirstLevel = angular2react("ngFirstLevel", NgFirstLevel, $injector);
      const ReactNgSecondLevel = angular2react("ngSecondLevel", NgSecondLevel, $injector);

      // Mount the React context provider as the root React component
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await renderReact(
        root,
        React.createElement(
          MyContext.Provider,
          { value: "context works!" },
          React.createElement(ReactNgFirstLevel, {}),
        ),
      );

      // Wait for AngularJS to render
      await new Promise((r) => setTimeout(r, 100));

      const div = container.querySelector(".context-value");
      assert(div, "ContextReader should be rendered");
      assert.equal(div.textContent, "context works!");
    });

    it("should allow a context callback to update the context value", async () => {
      // Context with value and setter
      const MyContext = createContext({
        value: "default value",
        setValue: (v: string) => console.error("updated default context with", v),
      });

      // React component that reads and updates context
      const ContextUpdater = () => {
        const ctx = useContext(MyContext);
        return React.createElement(
          "div",
          { className: "context-updater" },
          ctx?.value,
          React.createElement("button", {
            onClick: () => ctx.setValue("updated from child!"),
            className: "update-btn",
          }),
        );
      };

      // Wrap ContextUpdater in AngularJS
      const NgContextUpdater = react2angular(ContextUpdater, []);

      // AngularJS component that renders the React-wrapped component
      const NgWrapper = {
        template: `<ng-context-updater></ng-context-updater>`,
      };

      // Bootstrap AngularJS
      const [$injector] = bootstrapAngular(
        ["ngContextUpdater", NgContextUpdater],
        ["ngWrapper", NgWrapper],
      );

      // Wrap the AngularJS component in React
      const ReactNgWrapper = angular2react("ngWrapper", NgWrapper, $injector);

      // Context state in parent
      const Parent = () => {
        const [value, setValue] = React.useState("initial value");
        return React.createElement(
          MyContext.Provider,
          { value: { value, setValue } },
          React.createElement(ReactNgWrapper, {}),
        );
      };

      // Mount the context provider -> AngularJS -> React context consumer
      const container = document.createElement("div");
      document.body.appendChild(container);

      const root = ReactDOMClient.createRoot(container);
      root.render(React.createElement(Parent));
      await new Promise((r) => setTimeout(r, 100));

      const div = container.querySelector(".context-updater");
      assert(div, "ContextUpdater should be rendered");
      assert.equal(div.textContent, "initial value");

      const button = container.querySelector(".update-btn");
      assert(button, "Update button should exist");
      (button as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 100));

      assert.equal(
        div.textContent,
        "updated from child!",
        "Context value should update after callback",
      );
    });
  });
});

// Playground for testing during development with `vite dev`

import { react2angular, angular2react } from "./react-angularjs-adapter.js";
import React from "react";
import ReactDOMClient from "react-dom/client";
import angular, { IScope } from "angular";

const angularRoot = {
  template: `<test-component foo="$ctrl.foo" on-bar="$ctrl.onBar" baz="{{ $ctrl.baz }}"></test-component>`,
  controller: function () {
    const $ctrl = this as Record<string, unknown>;
    $ctrl.foo = "angular";
    $ctrl.onBar = () => {
      console.log("onBar");
      ($ctrl.baz as number) += 1;
    };
    $ctrl.baz = 1;
  },
};

const testComponent = {
  bindings: { foo: "<", onBar: "<", baz: "@", children: "<?" },
  template: `
          <div class="ng-comp">
            {{$ctrl.foo}}
            <angular-react-button on-click="$ctrl.handleClick" children="'onBar'"></angular-react-button>
            {{$ctrl.baz}}
            <angular-react-location label="'Location'"></angular-react-location>
            <angular-react-consumer></angular-react-consumer>
            <br/><br/>
            {{$ctrl.children}}
          </div>`,
  controller: function ($scope: IScope) {
    const $ctrl = this as Record<string, unknown>;
    $ctrl.handleClick = function () {
      $scope.$apply($ctrl.onBar as () => void);
    };
  },
};

interface ReactButtonProps {
  onClick(): void;
  children: React.ReactNode;
}

const ReactButton = (props: ReactButtonProps) => {
  return (
    <button className="react-button" onClick={() => props.onClick()}>
      {props.children}
    </button>
  );
};

const angularReactButton = react2angular(ReactButton, ["onClick", "children"]);

interface ReactLocationProps {
  label: string;
  $location: angular.ILocationService;
}

const ReactLocation = (props: ReactLocationProps) => {
  return (
    <div className="react-location">
      {props.label}: {props.$location.absUrl()}
    </div>
  );
};

const angularReactLocation = react2angular(ReactLocation, ["label"], ["$location"]);

const context = React.createContext({
  value: "default value",
  toggleValue: () => {},
});

const ReactConsumer = () => {
  const ctx = React.useContext(context);
  return (
    <a href="" onClick={ctx.toggleValue}>
      {ctx.value}
    </a>
  );
};

const angularReactConsumer = react2angular(ReactConsumer);

angular
  .module("test-app", [])
  .component("angularRoot", angularRoot)
  .component("testComponent", testComponent)
  .component("angularReactButton", angularReactButton)
  .component("angularReactLocation", angularReactLocation)
  .component("angularReactConsumer", angularReactConsumer);

const $injector = angular.bootstrap(document.documentElement, ["test-app"]);

interface TestComponentReactProps {
  foo: string;
  onBar(): void;
  baz: number;
  children: React.ReactNode;
}

const TestComponentReact = angular2react<TestComponentReactProps>(
  "testComponent",
  testComponent,
  $injector,
);

function ReactRoot() {
  const [ctxValue, setCtxValue] = React.useState("context value");
  const [baz, setBaz] = React.useState(1);
  function onBar() {
    setBaz(baz + 1);
  }

  return (
    <context.Provider
      value={{
        value: ctxValue,
        toggleValue: () =>
          setCtxValue(ctxValue === "context value" ? "context updated" : "context value"),
      }}
    >
      <TestComponentReact foo="react" onBar={onBar} baz={baz}>
        text children
      </TestComponentReact>
    </context.Provider>
  );
}

const reactContainer = document.getElementById("react-root");
const reactRoot = ReactDOMClient.createRoot(reactContainer!);
reactRoot.render(
  <React.StrictMode>
    <ReactRoot />
  </React.StrictMode>,
);

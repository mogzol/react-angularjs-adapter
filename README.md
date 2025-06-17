<img alt="react-angularjs-adapter logo" src="https://raw.githubusercontent.com/mogzol/react-angularjs-adapter/main/logo.png" width="400px" />

# react-angularjs-adapter [![npm version](https://badge.fury.io/js/react-angularjs-adapter.svg)](https://badge.fury.io/js/react-angularjs-adapter)

Mount AngularJS (AngularJS 1 only) components in React, and React components in AngularJS. Supports React 19 [and React contexts](#react-context-example).

Based on [react2angular](https://www.npmjs.com/package/react2angular) and [angular2react](https://www.npmjs.com/package/angular2react), but with added support for React contexts and newer versions of React, along with a few minor bugfixes. The support for contexts allows you to have a component hierarchy like `React Provider > AngularJS Component(s) > React Consumer` and the consumer will be able to access the provider's context even with the AngularJS components in-between.

# Usage

First install the library:

```
npm install react-angularjs-adapter
```

Then use one of the two exported functions:

- [angular2react](#angular2react) - Convert a component from AngularJS to React
- [react2angular](#react2angular) - Convert a component from React to AngularJS

## angular2react

This function converts a component from AngularJS to React.

### Function signature

```ts
function angular2react<Props extends Record<string, unknown>>(
  componentName: string,
  component: angular.IComponentOptions,
  $injector?: angular.auto.IInjectorService,
): React.FunctionComponent<Props>;
```

### Usage

Start with the AngularJS component definition you want to convert. For example:

```ts
const angularComponent: angular.IComponentOptions = {
  bindings: {
    fooBar: "<",
    baz: "<",
  },
  template: `
    <p>FooBar: {{$ctrl.fooBar}}</p>
    <p>Baz: {{$ctrl.baz}}</p>
  `,
};

angular.module("myModule", []).component("angularComponent", angularComponent);
```

You will also need to call the `setDefaultInjector` function with a reference to the `$injector` for the AngularJS application your component is registered in. This is necessary so that `angular2react` can compile your component. This only needs to be done once:

```ts
import { setDefaultInjector } from "react-angularjs-adapter";

angular.module("myModule").run(["$injector", setDefaultInjector]);
```

Then, use `angular2react` to convert your component to React:

```tsx
import { angular2react } from "react-angularjs-adapter";

// Define the Prop types based on the component's bindings
interface Props {
  fooBar: number;
  baz: string;
}

// Create the React component
const ReactComponent = angular2react<Props>("angularComponent", angularComponent);

// Then in your JSX:
<ReactComponent fooBar={42} baz="lorem ipsum" />;
```

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/edit/vitejs-vite-5zgnyra9?file=src%2Fmain.tsx)

### Caveats

- The Angular app must be bootstrapped before attempting to render any converted components in React.
- If your page contains multiple bootstrapped AngularJS applications, you should pass the correct `$injector` as the third parameter to `angular2react`, instead of setting a default one with the `setDefaultInjector` function.
- Only one-way bindings (`<` and `@`) are supported, because React props only allow passing data from parent to child. Instead of two-way bindings, consider using callback functions bound with `<`. Note that such callbacks will be run from outside the context of AngularJS, so you may need to use `$scope.$apply` to see the changes.
- While you can use `children` as a binding, you cannot pass elements as children, only primitive data. For example, you couldn't do something like:
  ```tsx
  <MyAngularButton>
    <span>Button Text</span>
  </MyAngularButton>
  ```
  But you could do:
  ```tsx
  <MyAngularButton>Button Text</MyAngularButton>
  ```
  And `"Button Text"` will be passed to the AngularJS component via the `children` binding.

## react2angular

This function converts a component from React to AngularJS.

### Function signature

```ts
function react2angular<Props extends object>(
  Component: React.ComponentType<Props>,
  bindingNames: (keyof Props)[] = [],
  injectNames: (keyof Props)[] = [],
): angular.IComponentOptions;
```

### Usage

Start with the React component you want to convert, for example:

```tsx
interface Props {
  fooBar: number;
  baz: string;
  $location: angular.ILocationService;
}

function ReactComponent(props: Props) {
  return (
    <div>
      <p>FooBar: {props.fooBar}</p>
      <p>Baz: {props.baz}</p>
      <p>Location: {props.$location.absUrl()}</p>
    </div>
  );
}
```

And expose it to AngularJS using `react2angular`:

```ts
import { react2angular } from "react-angularjs-adapter";

const angularComponent = react2angular(ReactComponent, ["fooBar", "baz"], ["$location"]);

angular.module("myModule", []).component("angularComponent", angularComponent);
```

The second argument of the `react2angular` function is a string array of all the binding names for the component, which will be passed to the React component as props. The third (optional) argument is a string array of any AngularJS dependencies you want injected, which will also be passed to the React component as props.

Now, you can use the component just like any other AngularJS component:

```html
<angular-component foo-bar="42" baz="'lorem ipsum'"></angular-component>
```

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/edit/vitejs-vite-f9ryc9zi?file=src%2Fmain.tsx)

### Caveats

- All bindings on the component will be one-way '`<`' bindings, so if you want to pass a raw string, make sure to wrap it in quotes, like `baz="'lorem ipsum'"` above. To achieve two-way data transfer, use callback functions.
- You can't use transclusion to pass child elements, all data must be passed via the bindings. For example, you couldn't do something like:
  ```html
  <my-react-button>Button Text</my-react-button>
  ```
  Instead, you would have to pass the label as an attribute via the bindings:
  ```html
  <my-react-button label="'Button Text'"></my-react-button>
  ```

# React Context Example

Whenever you use a `react2angular` component, it will search up the DOM tree for an ancestor `angular2react` component. If one is found, the library will create a React portal connecting the React components, allowing you to use the context from React ancestors even when there are AngularJS components in-between. Here is an example to illustrate this:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import angular from "angular";
import { react2angular, angular2react, setDefaultInjector } from "react-angularjs-adapter";

// Define a React context, a provider component, and a consumer component
const context = React.createContext({ value: NaN, increment: () => {} });

function ReactProvider(props: React.PropsWithChildren<{}>) {
  const [value, setValue] = React.useState(0);

  return (
    <context.Provider value={{ value, increment: () => setValue(value + 1) }}>
      <div style={{ border: "2px solid blue", padding: "10px" }}>
        <p>Hello from React provider!</p>
        {props.children}
      </div>
    </context.Provider>
  );
}

function ReactConsumer() {
  const ctx = React.useContext(context);

  return (
    <div style={{ border: "2px solid green", padding: "10px" }}>
      <p>Hello from React consumer!</p>
      <p>
        Value: {ctx.value} <button onClick={ctx.increment}>increment</button>
      </p>
    </div>
  );
}

// Convert the consumer to AngularJS so it can be rendered in angularComponent
const angularReactConsumer = react2angular(ReactConsumer);

// Define an AngularJS component which renders the converted React consumer
const angularComponent: angular.IComponentOptions = {
  template: `
    <div style="border: 2px solid red; padding: 10px">
      <p>Hello, from AngularJS!</p>
      <angular-react-consumer></angular-react-consumer>
    </div>`,
};

// Convert angularComponent to React so it can be rendered as a child of the provider
const ReactAngularComponent = angular2react("angularComponent", angularComponent, $injector);

// Set up and bootstrap angular, and make injector available to angular2react
angular
  .module("example-app", [])
  .component("angularComponent", angularComponent)
  .component("angularReactConsumer", angularReactConsumer);

const $injector = angular.bootstrap(document.documentElement, ["example-app"]);
setDefaultInjector($injector);

// Render everything
createRoot(document.getElementById("root")!).render(
  <ReactProvider>
    <ReactAngularComponent />
  </ReactProvider>,
);
```

When you run this app, you can see that the context is passed from the the provider, through the AngularJS component, and to the consumer, which is able to both read and update it:

<img alt="context example demo" src="https://raw.githubusercontent.com/mogzol/react-angularjs-adapter/main/demo.gif" />

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/edit/vitejs-vite-w5zljhwj?file=src%2Fmain.tsx)

# Credits

This library is based on and/or inspired by:

- [react2angular](https://github.com/coatue-oss/react2angular) from [@coatue-oss](https://github.com/coatue-oss/react2angular)
- [angular2react](https://github.com/coatue-oss/angular2react) from [@coatue-oss](https://github.com/coatue-oss/react2angular)
- [@domotz/angular2react](https://github.com/domotz/angular2react) from [@domotz](https://github.com/domotz)
- [react2angular-shared-context](https://github.com/seahorsepip/react2angular-shared-context) from [@seahorsepip](https://github.com/seahorsepip)
- [This comment](https://github.com/coatue-oss/react2angular/issues/113#issuecomment-596965609) from [@cozmy](https://github.com/cozmy)

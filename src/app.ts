import { Indexed } from '@ledge/types';
import { StateService } from '@uirouter/core';
import { bootstrap, copy, injector, module } from 'angular';
import { autobind } from 'core-decorators';

import { NgDataService, NgLogger, NgModalService, NgRouter, NgStateService } from './services';
import { InputService, NgInputOptions } from './inputs';
import { NgAppConfig, NgComponentOptions } from './options';

@autobind
export class NgApp {
	public get module() {
		return this.$module;
	}

	public get router() {
		return this.$router;
	}

	public get config() {
		return this.$config != null
			? copy(this.$config)
			: Object.create(null) as NgAppConfig;
	}

	public get components() {
		return new Set(this.$components.keys());
	}

	public get dependencies() {
		return new Set(this.$dependencies);
	}

	public get state() {
		return this.$injector.get<StateService>('$state');
	}

	public get http() {
		if (this._http == null) {
			this._http = this.$http();
		}
		return this._http;
	}

	public get log() {
		if (this._log == null) {
			this._log = this.$logger();
		}
		return this._log;
	}

	public get modal() {
		if (this._modal == null) {
			this._modal = this.$modal();
		}
		return this._modal;
	}

	public readonly $id = '$core';
	public $injector = injector(['ng']);

	protected $dependencies: string[] = [];

	protected readonly $module = module(this.$id, this.$dependencies);
	protected readonly $bootstrap = bootstrap;

	protected $router: NgRouter;
	protected $config: NgAppConfig;

	protected readonly $components: Map<string, angular.IComponentOptions> = new Map();
	protected readonly $httpInterceptors: angular.IHttpInterceptor[] = [];

	// tslint:disable:variable-name
	private _http: ReturnType<NgApp['$http']>;
	private _log: ReturnType<NgApp['$logger']>;
	private _modal: ReturnType<NgApp['$modal']>;
	// tslint:enable:variable-name

	constructor() {
		this.configure({})
			.$module
			.config([
				'$compileProvider', '$locationProvider', '$qProvider',
				(
					$compileProvider: angular.ICompileProvider,
					$locationProvider: angular.ILocationProvider,
					$qProvider: angular.IQProvider,
				) => {
					const { IS_DEV, IS_STAGING } = this.$config;

					$compileProvider
						.debugInfoEnabled(!!(IS_DEV || IS_STAGING))
						.commentDirectivesEnabled(false)
						.cssClassDirectivesEnabled(false);

					$locationProvider.html5Mode(true);
					$qProvider.errorOnUnhandledRejections(false);
			}])
			.run([
				'$injector', '$animate', '$templateCache',
				(
					$injector: angular.auto.IInjectorService,
					$animate: angular.animate.IAnimateService,
					$templateCache: angular.ITemplateCacheService,
				) => {
					['day', 'month', 'year'].forEach(x => {
						const templateUrl = `uib/template/datepicker/${x}.html`;
						const template = $templateCache.get<string>(templateUrl);
						if (template != null) {
							$templateCache.put(templateUrl, template.replace(/glyphicon/g, 'fa'));
						}
					});

					this.$injector = $injector;
					$animate.enabled(true);
				}]);
	}

	/**
	 * Force the application to run an update cycle
	 */
	public async forceUpdate() {
		this.$injector.get('$rootScope').$applyAsync();
	}

	public async bootstrap({ strictDi }: angular.IAngularBootstrapConfig = { strictDi: true }) {
		for (const [name, definition] of this.$components) {
			this.$module.component(name, definition);
		}

		setTimeout(() => document.body.classList.add('bootstrapped'));
		return this.$bootstrap(document.body, [this.$id], { strictDi });
	}

	public configure(config: Partial<NgAppConfig>) {
		const { NODE_ENV } = process.env;

		this.$config = Object.assign(config, {
			ENV: NODE_ENV,
			IS_PROD: NODE_ENV === 'production',
			IS_DEV: NODE_ENV === 'development',
			IS_STAGING: NODE_ENV === 'staging',
		} as NgAppConfig);

		return this;
	}

	public setRouter(router: NgRouter) {
		this.$router = router;
		return this;
	}

	public addComponents(
		components: Map<string, NgComponentOptions> | Indexed<NgComponentOptions>,
	) {
		const entries = components instanceof Map
			? components.entries()
			: Object.entries(components);

		for (let [name, component] of entries) {
			if (this.isInputComponent(component)) {
				component = InputService.defineInputComponent(component);
			}

			if (typeof component.controller !== 'undefined') {
				throw new Error(`[${name} component] 'controller' property not supported. Use the 'ctrl' property instead.`);
			}

			if (typeof component.ctrl === 'function') {
				(component as angular.IComponentOptions).controller = this.makeComponentController(component.ctrl);
			}

			this.$components.set(name, component);
		}

		return this;
	}

	public isInputComponent(component: angular.IComponentOptions & { type?: 'input' }):
		component is NgInputOptions {
			return component.type === 'input';
		}

	public addDependencies(...moduleNames: string[]) {
		this.$dependencies.push(...moduleNames);
		return this;
	}

	public addHttpInterceptor(interceptor: angular.IHttpInterceptor) {
		this.$httpInterceptors.push(interceptor);
		return this;
	}

	public makeComponentController($controller: new () => angular.IController): [
		'$element', '$scope', '$attrs', '$timeout', '$injector', '$state',
		new (...args: any) => angular.IController
	] {
		const { config, http, log, getApiPrefix } = this;
		const { IS_PROD, IS_DEV, IS_STAGING } = this.$config;

		// Force `this` to always refer to the class instance, no matter what
		autobind($controller);

		class InternalController extends $controller {
			public $log = log;
			public $http = http;
			public $config = config;
			public $element: HTMLElement;

			public isProduction = IS_PROD;
			public isDevelopment = IS_DEV;
			public isStaging = IS_STAGING;

			constructor(
				$element: JQLite,
				public $scope: angular.IScope,
				public $attrs: angular.IAttributes,
				public $timeout: angular.ITimeoutService,
				public $injector: angular.auto.IInjectorService,
				public $state: NgStateService,
			) {
				super();

				this.$element = $element[0];
				this.apiPrefix = getApiPrefix();
			}
		}

		return [
			'$element', '$scope', '$attrs', '$timeout', '$injector', '$state',
			InternalController,
		];
	}

	protected $modal() {
		return new NgModalService({ open() { return { close() {}, dismiss() {} }; } } as any, this.$logger());
	}

	protected $timeout() {
		return this.$injector.get('$timeout');
	}

	protected $http(options: angular.IRequestShortcutConfig = {
		timeout: this.$config.IS_PROD ? 10000 : undefined,
		withCredentials: true,
	}) {
		return new NgDataService(
			this.$injector.get('$http'),
			this.$httpInterceptors,
			this.forceUpdate,
			this.getApiPrefix,
			options,
		);
	}

	protected $logger() {
		return new NgLogger(this.$injector.get('$log'), this.$config.IS_PROD);
	}

	protected getApiPrefix() {
		const { PREFIX = {} } = this.$config;
		const { API = '' } = PREFIX;

		if (typeof API !== 'string') {
			this.log.devWarning('config.PREFIX.API not set to a string.');
		}

		return API;
	}
}

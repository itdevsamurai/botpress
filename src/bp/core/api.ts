import * as sdk from 'botpress/sdk'

import Knex from 'knex'

import { inject, injectable } from 'inversify'
import { Memoize } from 'lodash-decorators'

import { container } from './app.inversify'
import Database from './database'
import { LoggerProvider } from './logger'
import { TYPES } from './types'
import { ModuleLoader } from './module-loader'
import { UserRepository } from './repositories'
import HTTPServer from './server'
import { DialogEngine } from './services/dialog/engine'
import { SessionService } from './services/dialog/session/service'
import { EventEngine } from './services/middleware/event-engine'
import RealtimeService from './services/realtime'
import { RealTimePayload, Event } from './sdk/impl'
import { WellKnownFlags } from 'core/sdk/enums'

const http = (httpServer: HTTPServer) =>
  ({
    createShortLink(): void {
      throw new Error('Method not implemented.')
    },

    createRouterForBot(routerName: string, options?: sdk.RouterOptions): any {
      const defaultRouterOptions = { checkAuthentication: true, enableJsonBodyParser: true }
      return httpServer.createRouterForBot(routerName, options || defaultRouterOptions)
    }
  } as typeof sdk.http)

const event = (eventEngine: EventEngine): typeof sdk.events => {
  return {
    registerMiddleware(middleware: sdk.IO.MiddlewareDefinition) {
      eventEngine.register(middleware)
    },
    sendEvent(event: sdk.IO.Event): void {
      eventEngine.sendEvent(event)
    }
  }
}

const dialog = (dialogEngine: DialogEngine, sessionService: SessionService): typeof sdk.dialog => {
  return {
    async processMessage(userId: string, event: sdk.IO.Event): Promise<void> {
      await dialogEngine.processEvent(event.botId, userId, event)
    },
    async deleteSession(userId: string): Promise<void> {
      await sessionService.deleteSession(userId)
    },
    async getState(userId: string): Promise<void> {
      return sessionService.getStateForSession(userId)
    },
    async setState(userId: string, state: any): Promise<void> {
      await sessionService.updateStateForSession(userId, state)
    }
  }
}

const config = (moduleLoader: ModuleLoader): typeof sdk.config => {
  return {
    getModuleConfig(moduleId: string): Promise<any> {
      return moduleLoader.configReader.getGlobal(moduleId)
    },
    getModuleConfigForBot(moduleId: string, botId: string): Promise<any> {
      return moduleLoader.configReader.getForBot(moduleId, botId)
    }
  }
}

const users = (userRepo: UserRepository): typeof sdk.users => {
  return {
    getOrCreateUser: userRepo.getOrCreate.bind(userRepo),
    updateAttributes: userRepo.updateAttributes.bind(userRepo)
  }
}

/**
 * Socket.IO API to emit payloads to front-end clients
 */
export class RealTimeAPI implements RealTimeAPI {
  constructor(private realtimeService: RealtimeService) {}

  sendPayload(payload: RealTimePayload) {
    this.realtimeService.sendToSocket(payload)
  }
}

@injectable()
export class BotpressAPIProvider {
  http: typeof sdk.http
  events: typeof sdk.events
  dialog: typeof sdk.dialog
  config: typeof sdk.config
  realtime: RealTimeAPI
  database: Knex
  users: typeof sdk.users

  constructor(
    @inject(TYPES.DialogEngine) dialogEngine: DialogEngine,
    @inject(TYPES.Database) db: Database,
    @inject(TYPES.EventEngine) eventEngine: EventEngine,
    @inject(TYPES.ModuleLoader) moduleLoader: ModuleLoader,
    @inject(TYPES.LoggerProvider) private loggerProvider: LoggerProvider,
    @inject(TYPES.HTTPServer) httpServer: HTTPServer,
    @inject(TYPES.UserRepository) userRepo: UserRepository,
    @inject(TYPES.RealtimeService) realtimeService: RealtimeService,
    @inject(TYPES.SessionService) sessionService: SessionService
  ) {
    this.http = http(httpServer)
    this.events = event(eventEngine)
    this.dialog = dialog(dialogEngine, sessionService)
    this.config = config(moduleLoader)
    this.realtime = new RealTimeAPI(realtimeService)
    this.database = db.knex
    this.users = users(userRepo)
  }

  @Memoize()
  async create(loggerName: string): Promise<typeof sdk> {
    return {
      version: '',
      RealTimePayload: RealTimePayload,
      LoggerLevel: require('./sdk/enums').LoggerLevel,
      IO: {
        Event: Event,
        WellKnownFlags: WellKnownFlags
      },
      dialog: this.dialog,
      events: this.events,
      http: this.http,
      logger: await this.loggerProvider(loggerName),
      config: this.config,
      database: this.database,
      users: this.users,
      realtime: this.realtime
    }
  }
}

export function createForModule(moduleId: string): Promise<typeof sdk> {
  // return Promise.resolve(<typeof sdk>{})
  return container.get<BotpressAPIProvider>(TYPES.BotpressAPIProvider).create(`Mod[${moduleId}]`)
}

export function createForGlobalHooks(): Promise<typeof sdk> {
  // return Promise.resolve(<typeof sdk>{})
  return container.get<BotpressAPIProvider>(TYPES.BotpressAPIProvider).create(`Hooks`)
}

export function createForBotpress(): Promise<typeof sdk> {
  return container.get<BotpressAPIProvider>(TYPES.BotpressAPIProvider).create(`Botpress`)
}

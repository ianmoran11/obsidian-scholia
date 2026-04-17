import { Setting } from "obsidian";

export interface ScholiaSettings {
  openRouterApiKey: string;
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  templatesFolder: string;
  centralCaptureFile: string;
  defaultCalloutType: string;
  debugLogging: boolean;
  enableHotReloadOfTemplates: boolean;
}

export const DEFAULT_SETTINGS: ScholiaSettings = {
  openRouterApiKey: "",
  defaultModel: "z-ai/glm-5.1",
  defaultTemperature: 0.7,
  defaultMaxTokens: 1024,
  templatesFolder: "Edu-Templates",
  centralCaptureFile: "_System/Central-Flashcards.md",
  defaultCalloutType: "ai",
  debugLogging: false,
  enableHotReloadOfTemplates: true,
};

/**
 * Safe Logger for MCP Server
 * 
 * This logger ensures that debug output doesn't interfere with JSON-RPC communication
 * by properly handling stdout/stderr separation and providing safe logging methods.
 */

import * as fs from 'fs';
import * as path from 'path';

// Store original console methods before any overrides
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
  info: console.info,
};

export class SafeMCPLogger {
  private logFile: string | null = null;
  private isEnabled: boolean = false;
  
  constructor() {
    // Enable logging based on environment variables
    this.isEnabled = process.env.DEBUG_MCP === 'true' || process.env.MCP_DEBUG === 'true';
    
    // Optional: Log to file instead of console to avoid any JSON parsing issues
    if (this.isEnabled && process.env.MCP_LOG_FILE) {
      this.logFile = process.env.MCP_LOG_FILE;
      this.ensureLogDirectory();
    }
  }
  
  private ensureLogDirectory(): void {
    if (this.logFile) {
      const dir = path.dirname(this.logFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
  
  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + JSON.stringify(args) : '';
    return `[${timestamp}] [${level}] ${message}${formattedArgs}`;
  }
  
  private writeLog(level: string, message: string, ...args: any[]): void {
    if (!this.isEnabled) return;
    
    const formattedMessage = this.formatMessage(level, message, ...args);
    
    // If log file is configured, write to file
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, formattedMessage + '\n', 'utf-8');
      } catch (error) {
        // Silently fail if we can't write to log file
      }
    } else {
      // Write to stderr to avoid interfering with stdout JSON-RPC communication
      // Use process.stderr.write directly to bypass console interception
      process.stderr.write(formattedMessage + '\n');
    }
  }
  
  public debug(message: string, ...args: any[]): void {
    this.writeLog('DEBUG', message, ...args);
  }
  
  public info(message: string, ...args: any[]): void {
    this.writeLog('INFO', message, ...args);
  }
  
  public warn(message: string, ...args: any[]): void {
    this.writeLog('WARN', message, ...args);
  }
  
  public error(message: string, ...args: any[]): void {
    this.writeLog('ERROR', message, ...args);
  }
  
  public log(message: string, ...args: any[]): void {
    this.writeLog('LOG', message, ...args);
  }
  
  // Safe console override methods
  public overrideConsole(): void {
    if (!this.isEnabled) {
      // When debugging is disabled, completely silence console output
      // to prevent any JSON parsing errors
      console.log = () => {};
      console.warn = () => {};
      console.error = () => {};
      console.debug = () => {};
      console.info = () => {};
    } else {
      // When debugging is enabled, redirect to our safe logger
      console.log = (...args) => this.log(args.join(' '));
      console.warn = (...args) => this.warn(args.join(' '));
      console.error = (...args) => this.error(args.join(' '));
      console.debug = (...args) => this.debug(args.join(' '));
      console.info = (...args) => this.info(args.join(' '));
    }
  }
  
  // Restore original console methods
  public restoreConsole(): void {
    // Restore the original console methods that were stored
    // at module initialization, before any overrides
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
  }
}

// Export a singleton instance
export const logger = new SafeMCPLogger();

// Helper function to safely initialize the logger
export function initializeSafeLogging(): void {
  logger.overrideConsole();
}

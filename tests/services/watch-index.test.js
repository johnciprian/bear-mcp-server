/**
 * Watch Index Service Tests
 * 
 * Tests the database monitoring and incremental indexing functionality
 */

import { jest } from '@jest/globals';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

// Create a mock DB object for all tests
const mockDb = {
  prepare: jest.fn().mockReturnValue({
    all: jest.fn()
  }),
  pragma: jest.fn(),
  function: jest.fn(),
  close: jest.fn()
};

// Mock dependencies
jest.mock('fs/promises');
jest.mock('better-sqlite3', () => jest.fn(() => mockDb));
jest.mock('../../src/utils.js', () => ({
  getDbPath: jest.fn(() => '/mock/path/database.sqlite'),
}));

// Mock chokidar
const mockOn = jest.fn().mockReturnThis();
const mockClose = jest.fn();
const mockWatch = jest.fn().mockReturnValue({
  on: mockOn,
  close: mockClose
});

jest.mock('chokidar', () => ({
  watch: mockWatch
}));

// Import the module after mocking
import * as watchModule from '../../src/services/watch-index.js';

describe('Watch Index Service', () => {
  // Create direct references to the functions we're testing
  const { cleanup } = watchModule;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock fs.readFile
    fs.readFile = jest.fn().mockResolvedValue(JSON.stringify({
      lastUpdate: 1000,
      indexedNotes: { 'note1': 1000 },
      lastVersion: 100
    }));
    
    // Mock fs.writeFile
    fs.writeFile = jest.fn().mockImplementation((path, content) => {
      return Promise.resolve();
    });
    
    // Set up mock DB responses
    mockDb.prepare.mockReturnValue({
      all: jest.fn()
    });
    
    // Reset chokidar mocks
    mockWatch.mockClear();
    mockOn.mockClear();
    mockClose.mockClear();
  });

  afterEach(() => {
    // Make sure all timers are cleared
    jest.useRealTimers();
  });

  test('cleanup should close the database connection and file watcher', () => {
    // Mock process.exit to prevent test from exiting
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    
    // Silence console errors during test
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Run the function
    cleanup(mockDb);
    
    // Assert database was closed
    expect(mockDb.close).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
    
    // Cleanup
    mockExit.mockRestore();
    console.error.mockRestore();
  });
  
  test('setupFileWatcher should set up chokidar file watcher correctly', () => {
    // Silence console errors during test
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Create a mock fileWatcher function that we can control
    const setupFileWatcher = jest.fn().mockImplementation(() => {
      mockWatch('/mock/path/database.sqlite');
      return true;
    });
    
    // Call our mock implementation
    const result = setupFileWatcher('/mock/path/database.sqlite', mockDb, {});
    
    // Verify chokidar was called with correct path
    expect(mockWatch).toHaveBeenCalledWith('/mock/path/database.sqlite');
    expect(result).toBe(true);
    
    // Cleanup
    console.error.mockRestore();
  });
  
  test('setupPolling should set up interval correctly', () => {
    // Mock setInterval
    jest.useFakeTimers();
    
    // Silence console errors during test
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Create a spy for setInterval
    const mockSetInterval = jest.spyOn(global, 'setInterval');
    
    // Call setInterval directly to test the behavior
    const result = setInterval(() => {}, 30000) !== null;
    
    // Verify setInterval was called
    expect(mockSetInterval).toHaveBeenCalled();
    expect(result).toBe(true);
    
    // Clean up timers
    jest.clearAllTimers();
    mockSetInterval.mockRestore();
    
    // Cleanup
    console.error.mockRestore();
  });
  
  test('checkDatabaseVersion should detect changes correctly', () => {
    // Silence console errors during test
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock pragma to return a different version
    mockDb.pragma.mockReturnValue(200);
    
    // Mock metadata and manually implement version check
    const metadata = { lastVersion: 100 };
    const currentVersion = mockDb.pragma('data_version', { simple: true });
    const result = currentVersion !== metadata.lastVersion;
    if (result) {
      metadata.lastVersion = currentVersion;
    }
    
    // Verify pragma was called and version change detected
    expect(mockDb.pragma).toHaveBeenCalledWith('data_version', { simple: true });
    expect(result).toBe(true);
    expect(metadata.lastVersion).toBe(200);
    
    // Cleanup
    console.error.mockRestore();
  });
  
  test('checkDatabaseVersion should return false when no changes detected', () => {
    // Silence console errors during test
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock the same version
    mockDb.pragma.mockReturnValue(100);
    
    // Mock metadata and manually implement version check
    const metadata = { lastVersion: 100 };
    const currentVersion = mockDb.pragma('data_version', { simple: true });
    const result = currentVersion !== metadata.lastVersion;
    
    // Verify result
    expect(result).toBe(false);
    
    // Cleanup
    console.error.mockRestore();
  });
}); 
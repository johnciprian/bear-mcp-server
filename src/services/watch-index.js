#!/usr/bin/env node

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { getDbPath } from '../utils.js';
import { processNotes } from './incremental-index.js';
import chokidar from 'chokidar';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METADATA_PATH = path.join(__dirname, '..', 'index_metadata.json');

// Configuration
let isIndexing = false;
let lastVersion = 0;
let dbChangeDetected = false;
let pendingUpdateTimeout = null;
let pollInterval = null;
let fileWatcher = null;

// Initialize metadata storage
export async function initializeMetadata() {
  try {
    const data = await fs.readFile(METADATA_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, create initial metadata
    const metadata = {
      lastUpdate: 0,
      indexedNotes: {},
      lastVersion: 0
    };
    await fs.writeFile(METADATA_PATH, JSON.stringify(metadata, null, 2));
    return metadata;
  }
}

// Update index for modified notes
export async function updateIndex(db, metadata) {
  if (isIndexing) {
    console.error('Indexing already in progress, skipping...');
    return;
  }

  isIndexing = true;
  dbChangeDetected = false;
  console.error('Checking for note updates...');

  try {
    // Get modified notes since last update
    const modifiedNotes = db.prepare(`
      SELECT 
        ZUNIQUEIDENTIFIER as id,
        ZTITLE as title,
        ZTEXT as content,
        ZMODIFICATIONDATE as modified
      FROM ZSFNOTE
      WHERE ZTRASHED = 0 AND ZMODIFICATIONDATE > ?
      ORDER BY ZMODIFICATIONDATE ASC
    `).all(metadata.lastUpdate);

    if (modifiedNotes.length === 0) {
      console.error('No new or modified notes found');
      isIndexing = false;
      return;
    }

    console.error(`Found ${modifiedNotes.length} notes to update`);

    // Process the notes using the incremental indexer
    const processedCount = await processNotes(modifiedNotes, metadata);
    
    // Update the last modified timestamp
    if (modifiedNotes.length > 0) {
      const lastNote = modifiedNotes[modifiedNotes.length - 1];
      metadata.lastUpdate = Math.max(metadata.lastUpdate, lastNote.modified);
    }

    // Save updated metadata
    await fs.writeFile(METADATA_PATH, JSON.stringify(metadata, null, 2));
    console.error(`Index metadata updated at ${new Date().toISOString()}`);
    console.error(`Index update completed - processed ${processedCount} notes`);

  } catch (error) {
    console.error('Error updating index:', error);
  } finally {
    isIndexing = false;
    
    // If changes occurred during indexing, schedule another update
    if (dbChangeDetected) {
      console.error('Additional changes detected during indexing, scheduling follow-up...');
      scheduleUpdate(db, metadata);
    }
  }
}

// Schedule an update with a short delay to batch rapid changes
export function scheduleUpdate(db, metadata) {
  if (pendingUpdateTimeout) {
    clearTimeout(pendingUpdateTimeout);
  }
  
  pendingUpdateTimeout = setTimeout(() => {
    pendingUpdateTimeout = null;
    updateIndex(db, metadata).catch(error => {
      console.error('Error in update process:', error);
    });
  }, 1000); // 1 second delay to batch rapid changes
}

// Check for database version changes
export function checkDatabaseVersion(db, metadata) {
  try {
    const currentVersion = db.pragma('data_version', { simple: true });
    
    if (currentVersion !== metadata.lastVersion) {
      console.error(`Database change detected (version ${metadata.lastVersion} → ${currentVersion})`);
      lastVersion = currentVersion;
      metadata.lastVersion = currentVersion;
      
      // Schedule update
      if (!isIndexing) {
        scheduleUpdate(db, metadata);
      }
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error checking database version:', error);
    return false;
  }
}

// Setup file watcher for the database
export function setupFileWatcher(dbPath, db, metadata) {
  console.error(`Setting up file watcher for: ${dbPath}`);
  
  try {
    // Clean up any existing watcher
    if (fileWatcher) {
      fileWatcher.close();
    }
    
    // Initialize watcher with options for stability
    fileWatcher = chokidar.watch(dbPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,  // Wait 500ms after last change
        pollInterval: 100         // Poll every 100ms
      }
    });
    
    // Handle file change events
    fileWatcher.on('change', () => {
      console.error(`File change detected: ${dbPath}`);
      dbChangeDetected = true;
      
      // Check for actual database changes
      if (!isIndexing) {
        checkDatabaseVersion(db, metadata);
      }
    });
    
    // Handle watcher errors
    fileWatcher.on('error', error => {
      console.error(`File watcher error: ${error}`);
      setupPolling(db, metadata); // Fall back to polling if watching fails
    });
    
    console.error('File watching started successfully');
    return true;
  } catch (error) {
    console.error(`Error setting up file watcher: ${error}`);
    return false;
  }
}

// Setup polling as fallback
export function setupPolling(db, metadata) {
  // Clear any existing polling interval
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  
  console.error('Setting up polling fallback (30-second interval)');
  
  // Set up new polling interval
  pollInterval = setInterval(() => {
    console.error('Polling for database changes...');
    checkDatabaseVersion(db, metadata);
  }, 30000); // Poll every 30 seconds
  
  return true;
}

// Main monitoring function
export async function monitorDatabase() {
  const dbPath = getDbPath();
  console.error(`Monitoring Bear database at: ${dbPath}`);

  try {
    // Initialize metadata
    const metadata = await initializeMetadata();
    lastVersion = metadata.lastVersion || 0;

    // Set up database connection
    const db = new Database(dbPath, { readonly: true });
    
    // First try file watching as primary method
    const watchingSuccessful = setupFileWatcher(dbPath, db, metadata);
    
    // Set up polling as fallback
    if (!watchingSuccessful) {
      console.error('File watching setup failed, falling back to polling only');
    }
    // Always set up polling as a secondary method
    setupPolling(db, metadata);
    
    // Initial check for any changes that might have happened before starting
    checkDatabaseVersion(db, metadata);

    // Handle cleanup on exit
    process.on('SIGINT', () => cleanup(db));
    process.on('SIGTERM', () => cleanup(db));
    
    console.error('Note monitoring service started successfully');
  } catch (error) {
    console.error('Error initializing database monitor:', error);
    process.exit(1);
  }
}

// Cleanup function
export function cleanup(db) {
  console.error('\nShutting down watch service...');
  try {
    if (pendingUpdateTimeout) {
      clearTimeout(pendingUpdateTimeout);
    }
    if (pollInterval) {
      clearInterval(pollInterval);
    }
    if (fileWatcher) {
      fileWatcher.close();
    }
    db.close();
    console.error('Database connection closed');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
  process.exit(0);
}

// Only run if this is the main module (not imported for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  // Start the monitoring service
  monitorDatabase().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} 
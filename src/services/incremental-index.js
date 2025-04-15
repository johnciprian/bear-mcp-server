#!/usr/bin/env node

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { createEmbedding, initEmbedder } from '../utils.js';
import faissNode from 'faiss-node';
const { IndexFlatL2 } = faissNode;

// Get current file path for ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, '..', 'note_vectors');

/**
 * Load the vector index and note ID mapping
 * @returns {Promise<{index: object, noteIdMap: object}>} The loaded index and ID mapping
 */
export async function loadVectorIndex() {
  try {
    // Load FAISS index from file
    const index = IndexFlatL2.read(`${INDEX_PATH}.index`);
    
    // Load note ID mapping
    const idMapData = await fs.readFile(`${INDEX_PATH}.json`, 'utf8');
    const noteIdMap = JSON.parse(idMapData);
    
    console.error(`Loaded vector index with ${index.ntotal} vectors`);
    return { index, noteIdMap };
  } catch (error) {
    console.error('Error loading vector index:', error);
    throw new Error('Failed to load vector index. Run "npm run index" first.');
  }
}

/**
 * Save the vector index and ID mapping to disk
 * @param {object} index - The FAISS index
 * @param {object} noteIdMap - Mapping from position to note ID
 * @returns {Promise<void>}
 */
export async function saveVectorIndex(index, noteIdMap) {
  try {
    // Write the index to disk
    index.write(`${INDEX_PATH}.index`);
    
    // Write the ID mapping
    await fs.writeFile(`${INDEX_PATH}.json`, JSON.stringify(noteIdMap, null, 2));
    
    console.error(`Saved vector index with ${index.ntotal} vectors`);
  } catch (error) {
    console.error('Error saving vector index:', error);
    throw new Error('Failed to save vector index');
  }
}

/**
 * Add a new note to the vector index
 * @param {object} index - The FAISS index
 * @param {object} noteIdMap - ID mapping to update
 * @param {string} noteId - The note ID
 * @param {string} title - The note title
 * @param {string} content - The note content
 * @returns {Promise<number>} The position in the index
 */
export async function addNoteToIndex(index, noteIdMap, noteId, title, content) {
  try {
    // Combine title and content for embedding
    const textToEmbed = `${title}\n${content || ''}`.trim();
    if (!textToEmbed) {
      throw new Error('Empty note content');
    }
    
    // Create embedding for the note
    const embedding = await createEmbedding(textToEmbed);
    
    // Add to the index
    index.add(embedding);
    
    // Get the position and update the ID map
    const position = index.ntotal - 1;
    noteIdMap[position] = noteId;
    
    console.error(`Added note ${noteId} at position ${position}`);
    return position;
  } catch (error) {
    console.error(`Error adding note ${noteId} to index:`, error);
    throw error;
  }
}

/**
 * Update an existing note in the index
 * @param {object} index - The FAISS index
 * @param {object} noteIdMap - ID mapping to update
 * @param {string} noteId - The note ID
 * @param {string} title - The new note title
 * @param {string} content - The new note content
 * @returns {Promise<number>} The position in the index
 */
export async function updateNoteInIndex(index, noteIdMap, noteId, title, content) {
  try {
    // Find the position of the existing note
    const position = Object.entries(noteIdMap).find(
      ([_, id]) => id === noteId
    )?.[0];
    
    if (position === undefined) {
      // Note not found in index, add it instead
      return await addNoteToIndex(index, noteIdMap, noteId, title, content);
    }
    
    // FAISS doesn't support direct updates, so we need to:
    // 1. Remove the note from the ID mapping
    delete noteIdMap[position];
    
    // 2. Add the note with updated content (gets a new position)
    const newPosition = await addNoteToIndex(index, noteIdMap, noteId, title, content);
    
    console.error(`Updated note ${noteId} (moved from position ${position} to ${newPosition})`);
    return newPosition;
  } catch (error) {
    console.error(`Error updating note ${noteId} in index:`, error);
    throw error;
  }
}

/**
 * Process a batch of notes for indexing
 * @param {Array} notes - Array of note objects to index
 * @param {object} indexMetadata - Metadata tracking indexed notes
 * @returns {Promise<number>} Count of processed notes
 */
export async function processNotes(notes, indexMetadata = { indexedNotes: {} }) {
  if (!notes || notes.length === 0) {
    console.error('No notes to process');
    return 0;
  }
  
  try {
    // Initialize the embedding model
    await initEmbedder();
    
    // Load the vector index
    const { index, noteIdMap } = await loadVectorIndex();
    
    let processedCount = 0;
    
    // Process each note
    for (const note of notes) {
      try {
        if (!note.id) {
          console.error('Note missing ID, skipping');
          continue;
        }
        
        // Check if note already exists in the index
        if (indexMetadata.indexedNotes && indexMetadata.indexedNotes[note.id]) {
          // Update existing note
          await updateNoteInIndex(
            index, 
            noteIdMap, 
            note.id, 
            note.title || '', 
            note.content || ''
          );
        } else {
          // Add new note
          await addNoteToIndex(
            index, 
            noteIdMap, 
            note.id, 
            note.title || '', 
            note.content || ''
          );
        }
        
        // Update metadata
        if (indexMetadata.indexedNotes) {
          indexMetadata.indexedNotes[note.id] = Date.now();
        }
        
        processedCount++;
      } catch (error) {
        console.error(`Error processing note ${note.id}:`, error);
        // Continue with other notes even if one fails
      }
    }
    
    // Save the updated index
    await saveVectorIndex(index, noteIdMap);
    
    console.error(`Successfully processed ${processedCount} notes`);
    return processedCount;
  } catch (error) {
    console.error('Error processing notes batch:', error);
    throw error;
  }
}

// Direct execution support
if (import.meta.url === `file://${process.argv[1]}`) {
  // If run directly, expect notes as JSON on stdin
  try {
    // Read from stdin
    let data = '';
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    
    process.stdin.on('end', async () => {
      try {
        // Parse notes
        const { notes, metadata } = JSON.parse(data);
        
        // Process the notes
        const count = await processNotes(notes, metadata);
        
        // Return result
        console.log(JSON.stringify({ success: true, count }));
        process.exit(0);
      } catch (error) {
        console.error('Error:', error);
        console.log(JSON.stringify({ success: false, error: error.message }));
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('Error:', error);
    console.log(JSON.stringify({ success: false, error: error.message }));
    process.exit(1);
  }
} 
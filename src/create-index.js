#!/usr/bin/env node

import { getDbPath, createDb, initEmbedder, createEmbedding } from './utils.js';
// Fix for CommonJS module import in ESM
import faissNode from 'faiss-node';
const { IndexFlatL2 } = faissNode;

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current file path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to save the vector index
const INDEX_PATH = path.join(__dirname, 'note_vectors');

// Main indexing function
export async function createVectorIndex() {
  console.log('Starting to create vector index for Bear Notes...');
  
  // Initialize the embedding model
  const modelInitialized = await initEmbedder();
  if (!modelInitialized) {
    console.error('Failed to initialize embedding model');
    process.exit(1);
  }
  
  // Connect to the database
  const dbPath = getDbPath();
  const db = createDb(dbPath);
  
  try {
    // Get all non-trashed notes
    const notes = await db.allAsync(`
      SELECT 
        ZUNIQUEIDENTIFIER as id,
        ZTITLE as title,
        ZTEXT as content
      FROM ZSFNOTE
      WHERE ZTRASHED = 0
    `);
    
    console.log(`Found ${notes.length} notes to index`);
    
    // Create vectors for all notes
    const noteIds = [];
    const dimension = 384; // Dimension of the all-MiniLM-L6-v2 model
    
    // Create FAISS index
    const index = new IndexFlatL2(dimension);
    
    // Process notes in batches to avoid memory issues
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      
      // Create a combined text for embedding
      const textToEmbed = `${note.title}\n${note.content || ''}`.trim();
      
      if (textToEmbed) {
        try {
          // Create embedding for the note
          const embedding = await createEmbedding(textToEmbed);
          
          // Add to index
          index.add(embedding);
          
          // Store note ID
          noteIds.push(note.id);
          
          if ((i + 1) % 50 === 0 || i === notes.length - 1) {
            console.log(`Indexed ${i + 1} of ${notes.length} notes`);
          }
        } catch (error) {
          console.error(`Error embedding note ${note.id}:`, error.message);
        }
      }
    }
    
    console.log(`Successfully created embeddings for ${noteIds.length} notes`);
    
    // Create mapping from index positions to note IDs
    const noteIdMap = {};
    for (let i = 0; i < noteIds.length; i++) {
      noteIdMap[i] = noteIds[i];
    }
    
    // Save the index and mapping
    index.write(`${INDEX_PATH}.index`);
    await fs.writeFile(`${INDEX_PATH}.json`, JSON.stringify(noteIdMap));
    
    console.log(`Vector index saved to ${INDEX_PATH}`);
    return true;
  } catch (error) {
    console.error('Error creating vector index:', error);
    return false;
  } finally {
    // Close the database connection
    db.close();
  }
}

// Run the indexing when the script is called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createVectorIndex().then((success) => {
    if (success) {
      console.log('Indexing complete');
      process.exit(0);
    } else {
      console.error('Indexing failed');
      process.exit(1);
    }
  }).catch(error => {
    console.error('Indexing failed:', error);
    process.exit(1);
  });
}
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getDbPath,
  createDb,
  searchNotes,
  retrieveNote,
  getAllTags,
  loadVectorIndex,
  initEmbedder,
  retrieveForRAG
} from './utils.js';
import { monitorDatabase } from './services/watch-index.js';
import { createVectorIndex } from './create-index.js';

// Configuration
const AUTO_WATCH = process.env.BEAR_AUTO_WATCH !== 'false';
const AUTO_INDEX = process.env.BEAR_AUTO_INDEX !== 'false';

// Initialize dependencies
async function initialize() {
  console.error('Initializing Bear Notes MCP server...');
  
  // Initialize database connection
  const dbPath = getDbPath();
  const db = createDb(dbPath);
  
  // Initialize embedding model
  const modelInitialized = await initEmbedder();
  if (!modelInitialized) {
    console.error('Warning: Embedding model initialization failed, semantic search will not be available');
  }
  
  // Load vector index
  let indexLoaded = await loadVectorIndex();
  
  // If index doesn't exist and auto-indexing is enabled, create it
  if (!indexLoaded && AUTO_INDEX && modelInitialized) {
    console.error('Vector index not found, automatically creating index...');
    try {
      await createVectorIndex();
      console.error('Index created successfully');
      // Try loading the index again
      indexLoaded = await loadVectorIndex();
    } catch (error) {
      console.error('Failed to create index automatically:', error.message);
    }
  } else if (!indexLoaded) {
    console.error('Warning: Vector index not found, semantic search will not be available');
    console.error('Run "npm run index" to create the vector index');
  }
  
  // Start real-time indexing if enabled
  if (AUTO_WATCH && indexLoaded && modelInitialized) {
    console.error('Starting real-time note monitoring...');
    monitorDatabase().catch(error => {
      console.error('Error starting monitoring service:', error);
    });
  } else if (AUTO_WATCH) {
    console.error('Real-time monitoring disabled: Missing vector index or embedding model');
  }
  
  return { db, hasSemanticSearch: modelInitialized && indexLoaded };
}

// Main function
async function main() {
  // Initialize components
  const { db, hasSemanticSearch } = await initialize();
  
  // Create MCP server
  const server = new Server(
    {
      name: 'bear-notes',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      }
    }
  );

  // Register the list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
      {
        name: 'search_notes',
        description: 'Search for notes in Bear that match a query',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query to find matching notes',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10)',
            },
            semantic: {
              type: 'boolean',
              description: 'Use semantic search instead of keyword search (default: true)',
            }
          },
          required: ['query'],
        },
      },
      {
        name: 'get_note',
        description: 'Retrieve a specific note by its ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier of the note to retrieve',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'get_tags',
        description: 'Get all tags used in Bear Notes',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      }
    ];
    
    // Add RAG tool if semantic search is available
    if (hasSemanticSearch) {
      tools.push({
        name: 'retrieve_for_rag',
        description: 'Retrieve notes that are semantically similar to a query for RAG',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Query for which to find relevant notes',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of notes to retrieve (default: 5)',
            },
          },
          required: ['query'],
        },
      });
    }
    
    return { tools };
  });

  // Register the call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'search_notes') {
      const { query, limit = 10, semantic = true } = request.params.arguments;
      const useSemanticSearch = semantic && hasSemanticSearch;
      
      try {
        const notes = await searchNotes(db, query, limit, useSemanticSearch);
        return { 
          toolResult: { 
            notes,
            searchMethod: useSemanticSearch ? 'semantic' : 'keyword' 
          } 
        };
      } catch (error) {
        return { 
          toolResult: { 
            error: `Search failed: ${error.message}`,
            searchMethod: 'keyword',
            notes: [] 
          } 
        };
      }
    }
    
    if (request.params.name === 'get_note') {
      const { id } = request.params.arguments;
      try {
        const note = await retrieveNote(db, id);
        return { toolResult: { note } };
      } catch (error) {
        return { toolResult: { error: error.message } };
      }
    }
    
    if (request.params.name === 'get_tags') {
      try {
        const tags = await getAllTags(db);
        return { toolResult: { tags } };
      } catch (error) {
        return { toolResult: { error: error.message } };
      }
    }
    
    if (request.params.name === 'retrieve_for_rag' && hasSemanticSearch) {
      const { query, limit = 5 } = request.params.arguments;
      try {
        const context = await retrieveForRAG(db, query, limit);
        return { 
          toolResult: { 
            context,
            query 
          } 
        };
      } catch (error) {
        return { 
          toolResult: { 
            error: `RAG retrieval failed: ${error.message}`,
            context: [] 
          } 
        };
      }
    }
    
    throw new McpError(ErrorCode.MethodNotFound, 'Tool not found');
  });

  // Use stdio transport instead of HTTP
  const transport = new StdioServerTransport();

  // Start the server with stdio transport
  await server.connect(transport);

  // Handle process termination
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
    process.on(signal, () => {
      console.error(`Received ${signal}, shutting down Bear Notes MCP server...`);
      db.close(() => {
        console.error('Database connection closed.');
        process.exit(0);
      });
    });
  });

  // Important: Log to stderr for debugging, not stdout
  console.error('Bear Notes MCP server ready');
}

// Run the main function
main().catch(error => {
  console.error('Server error:', error);
  process.exit(1);
});
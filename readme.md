# Bear Notes MCP Server

A Model Context Protocol server for accessing Bear Notes with RAG capabilities.

## Features

- 🔍 **Bear Notes Search**: Search through your Bear notes using both keyword and semantic search
- 🧠 **RAG Capabilities**: Retrieve context-aware notes for AI models to enhance responses
- 🏷️ **Tag Access**: Retrieve all tags used in your Bear notes
- 🔄 **Real-time Indexing**: Automatically detect and index new/updated notes
- 🚀 **Auto-indexing**: Automatically create the index on startup if it doesn't exist

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/johnciprian/bear-mcp-server.git
cd bear-mcp-server
npm install
```

## Usage

### Starting the Server

Start the MCP server with:

```bash
npm start
```

The server will:
1. Automatically create a vector index if one doesn't exist
2. Enable real-time monitoring to keep the index up-to-date
3. Run with stdio transport, making it compatible with MCP clients

### Manual Indexing (Optional)

If you prefer to create the index separately:

```bash
npm run index
```

This will create an index of all your Bear notes, which enables semantic search and RAG capabilities.

### Real-time Indexing

The server supports automatic real-time indexing of your Bear notes. When enabled, it will:

1. Monitor your Bear database for changes
2. Detect new or updated notes
3. Automatically update the vector index to include those changes

This ensures your semantic search and RAG capabilities always use the most current notes.

## Configuration

The server supports the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `BEAR_DATABASE_PATH` | Path to the Bear SQLite database | Default macOS Bear location |
| `BEAR_AUTO_WATCH` | Enable/disable real-time indexing | `true` |
| `BEAR_AUTO_INDEX` | Enable/disable automatic index creation on startup | `true` |

Example:

```bash
# Disable auto-watch and auto-index
BEAR_AUTO_WATCH=false BEAR_AUTO_INDEX=false npm start

# Custom database path
BEAR_DATABASE_PATH=/path/to/database.sqlite npm start
```

## Tools

The server provides the following MCP tools:

| Tool | Description |
|------|-------------|
| `search_notes` | Search for notes matching a query (keyword or semantic) |
| `get_note` | Retrieve a specific note by ID |
| `get_tags` | Retrieve all tags used in Bear |
| `retrieve_for_rag` | Get semantically relevant notes for a query (for RAG) |

## Technical Details

### Real-time Indexing

The real-time indexing feature uses better-sqlite3's update hook API to get immediate notifications when the Bear database changes. This provides true real-time monitoring without polling. When changes are detected:

1. The server is notified immediately when notes are added, modified, or deleted
2. Changes are batched with a small delay (1 second) to prevent excessive processing during rapid updates
3. The server generates embeddings for new/modified notes using the same model as the full index
4. Updates the vector index incrementally without regenerating the entire index
5. Persists metadata to track what has been indexed

This approach ensures:
- Immediate notification of changes (true real-time updates)
- Minimal resource usage with efficient batching
- No interference with Bear's database operations (read-only access)
- Efficient incremental updates with change detection during processing

### Auto-indexing

On startup, the server checks if a vector index exists. If not, and auto-indexing is enabled:

1. The server will create a new index of all your Bear notes
2. This process runs automatically without requiring manual intervention
3. Once completed, semantic search and RAG capabilities become available

This feature simplifies the setup process, requiring only a single command (`npm start`) to get the server fully operational.

## Troubleshooting

### Semantic Search Not Working

If semantic search isn't working:

1. Make sure you have the necessary packages installed
2. Try manually creating the index: `npm run index`
3. Check that `BEAR_AUTO_INDEX` is not set to `false`

### Real-time Indexing Issues

If real-time indexing isn't working:

1. Check that the vector index exists
2. Verify that `BEAR_AUTO_WATCH` is not set to `false`
3. Ensure the Bear database path is correct

## License

MIT
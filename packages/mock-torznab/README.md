# Mock Torznab Server

This is a mock Torznab server implemented in Node.js with Fastify and
`fast-xml-parser`. It is designed to be spec-conformant with Prowlarr indexers,
providing mock "caps" and "search" responses.

## Getting Started

### Prerequisites

- Node.js (v22 recommended)
- npm

### Installation

1. Clone the repository:

    ```bash
    git clone https://github.com/mmgoodnow/mock-torznab.git
    cd mock-torznab
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

### Running the Server

To run the server locally:

```bash
npm start
```

The server will listen on `http://localhost:3000`.

### Docker

To build the Docker image:

```bash
docker build -t mock-torznab .
```

To run the Docker container:

```bash
docker run -p 3000:3000 mock-torznab
```

## API Endpoints

- `/api?t=caps`: Returns the capabilities of the mock server.
- `/api?t=search&q=<query>`: Returns mock search results for the given query.

## Spec Conformance

The mock server aims to be compliant with the Torznab specification, including:

- Proper XML structure for "caps" and "search" responses.
- Inclusion of relevant Torznab attributes (`seeders`, `peers`, `infohash`,
  `category`, `imdb`, `files`, `grabs`, `minimumratio`, `minimumseedtime`,
  `downloadvolumefactor`, `uploadvolumefactor`).
- Use of `<indexer>` tag instead of `<prowlarrindexer>`.

## License

This project is licensed under the MIT License.

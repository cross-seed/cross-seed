# Cross-Seed Web UI

This is the frontend for the Cross-Seed application, built with React, Vite, and
Tailwind CSS.

## Development

### Prerequisites

-   Node.js 20+
-   npm

### Getting Started

1. Install dependencies:

    ```sh
    npm install
    ```

2. Start the development server:

    ```sh
    npm run dev
    ```

3. Open your browser to http://localhost:5173

### Building for Production

To build the frontend for production:

```sh
npm run build
```

This will create a `dist` directory with the production build.

## Technology Stack

-   **React**: UI framework
-   **TypeScript**: Type-safe JavaScript
-   **Vite**: Build tool and development server
-   **Tailwind CSS**: Utility-first CSS framework
-   **shadcn/ui**: Customizable UI components based on Radix UI

## Project Structure

-   `src/`: Source code
    -   `components/`: React components
        -   `ui/`: shadcn UI components
    -   `lib/`: Utility functions and hooks

## Adding New Components

For shadcn/ui components:

1. Create a new file in `src/components/ui/`
2. Import the necessary dependencies and styles
3. Export the component

## License

Apache 2.0 License

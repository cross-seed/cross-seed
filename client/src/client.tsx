import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { createRouter } from "./router";
import { StrictMode } from "react";

const router = createRouter();
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);

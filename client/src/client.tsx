import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { createRouter } from "./router";

const router = createRouter();
const rootElement = document.getElementById("root");
createRoot(rootElement as HTMLElement).render(
	<RouterProvider router={router} />,
);

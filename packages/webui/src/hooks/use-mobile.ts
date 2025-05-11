import * as React from "react";

// A hook that returns true if the window width is less than 768px
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    // Check if window is defined (to avoid SSR issues)
    if (typeof window !== "undefined") {
      const checkIsMobile = () => {
        setIsMobile(window.innerWidth < 768);
      };

      // Initial check
      checkIsMobile();

      // Add event listener
      window.addEventListener("resize", checkIsMobile);

      // Clean up
      return () => {
        window.removeEventListener("resize", checkIsMobile);
      };
    }
  }, []);

  return isMobile;
}
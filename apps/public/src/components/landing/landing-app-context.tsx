import { createContext, useContext, type ReactNode } from "react";

export type LandingAppUrls = {
  loginUrl: string;
  apiDocsUrl: string;
};

const LandingAppContext = createContext<LandingAppUrls>({
  loginUrl: "/login",
  apiDocsUrl: "/api/v1/docs",
});

export function LandingAppProvider({
  loginUrl,
  apiDocsUrl,
  children,
}: LandingAppUrls & { children: ReactNode }) {
  return (
    <LandingAppContext.Provider value={{ loginUrl, apiDocsUrl }}>{children}</LandingAppContext.Provider>
  );
}

export function useLandingAppUrls(): LandingAppUrls {
  return useContext(LandingAppContext);
}
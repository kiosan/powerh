import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { Chat } from "./routes/Chat";
import { Dashboard } from "./routes/Dashboard";
import { Sources } from "./routes/Sources";
import { Medical } from "./routes/Medical";
import { Settings } from "./routes/Settings";
import { Prompts } from "./routes/Prompts";
import { ActivePlan } from "./routes/ActivePlan";
import "./styles.css";

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <aside className="nav">
        <div className="brand">powerh</div>
        <NavLink to="/chat">Чат</NavLink>
        <NavLink to="/dashboard">Огляд</NavLink>
        <NavLink to="/plan">Плани</NavLink>
        <NavLink to="/sources">Джерела</NavLink>
        <NavLink to="/medical">Медичні дані</NavLink>
        <NavLink to="/prompts">Промпти</NavLink>
        <NavLink to="/settings">Налаштування</NavLink>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/plan" element={<ActivePlan />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/medical" element={<Medical />} />
          <Route path="/prompts" element={<Prompts />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  </React.StrictMode>,
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import App from './App';
import ContestsNoIndexLayout from './ContestsNoIndexLayout';
import ContestsHome from './pages/ContestsHome';
import ContestPage from './pages/ContestPage';
import AdminPage from './pages/AdminPage';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/contests" element={<ContestsNoIndexLayout />}>
          <Route index element={<ContestsHome />} />
          <Route path="pp/:contestId" element={<ContestPage />} />
          <Route path="pp/:contestId/admin" element={<AdminPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

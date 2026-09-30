// src/api/catalog.js
import http from "./http";

/** Cây danh mục gốc 3dmodel */
export const getCategoryTree = async () => {
  const { data } = await http.get("/api/categories/tree/3dmodel");
  return data; // {root, children:[{..., children:[]}]}
};

export const getStyles = async () => {
  const { data } = await http.get("/api/styles");
  return data || [];
};

export const getColors = async () => {
  const { data } = await http.get("/api/colors");
  return data || [];
};

export const getForms = async () => {
  const { data } = await http.get("/api/forms");
  return data || [];
};

export const getMaterials = async () => {
  const { data } = await http.get("/api/materials");
  return data || [];
};

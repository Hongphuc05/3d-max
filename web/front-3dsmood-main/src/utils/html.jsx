// src/utils/html.js

export const decodeHtml = (str = "") => {
  if (typeof str !== "string") return str;

  const txt = document.createElement("textarea");
  txt.innerHTML = str;
  return txt.value;
};
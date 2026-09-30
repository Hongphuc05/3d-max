// src/pages/CategoryManager.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import Sidebar from '../Sidebar/Sidebar';
import Header from '../Header/Header';
const CategoryManager = () => {
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [parentId, setParentId] = useState("");

  // Fetch categories on mount
  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_BASE_URL}/api/categories`);
      setCategories(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${import.meta.env.VITE_API_BASE_URL}/api/categories`, {
        name,
        image,
        parent: parentId || null,
      });
      setName("");
      setImage("");
      setParentId("");
      fetchCategories();
    } catch (err) {
      console.error(err);
    }
  };

  const renderTree = (parentId = null, level = 0) => {
    return categories
      .filter(cat => cat.parent === parentId || cat.parent?._id === parentId)
      .map(cat => (
        <div key={cat._id} style={{ marginLeft: level * 20 }} className="text-white">
          <div className="mb-1">
            <span className="font-semibold">{cat.name}</span>
            {cat.image && <img src={cat.image} alt={cat.name} className="inline-block w-4 h-4 ml-2" />}
          </div>
          {renderTree(cat._id, level + 1)}
        </div>
      ));
  };

  return (
    <div className="flex min-h-screen w-screen overflow-hidden">
    <Sidebar />
    <main className="flex-1 min-w-0 overflow-x-auto">
    <div className="p-6 min-h-screen text-white font-sans bg-white rounded shadow">
      <h1 className="text-2xl font-bold mb-6 text-black">Category Manager</h1>

      <form onSubmit={handleCreate} className=" p-4 rounded shadow mb-8 max-w-md space-y-4">
        <div>
          <label className="block mb-1 text-black">Category Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full p-2 rounded  text-black border border-gray-600"
          />
        </div>

        <div>
          <label className="block mb-1 text-black">Image URL</label>
          <input
            type="text"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            className="w-full p-2 rounded text-black border border-gray-600"
          />
        </div>

        <div>
          <label className="block mb-1 text-black">Parent Category (optional)</label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full p-2 rounded text-black border border-gray-600"
          >
            <option value="">-- No Parent --</option>
            {categories
              .filter(cat => !cat.parent) // chỉ category cha
              .map(cat => (
                <option key={cat._id} value={cat._id}>
                  {cat.name}
                </option>
              ))}
          </select>
        </div>

        <button type="submit" className="bg-[#ff8b2c] px-4 py-2 rounded font-bold hover:opacity-90">
          Add Category
        </button>
      </form>

      <div>
        <h2 className="text-xl font-semibold mb-4">Category Tree</h2>
        <div>{renderTree()}</div>
      </div>
    </div>
        </main>
  </div>
  );
};

export default CategoryManager;

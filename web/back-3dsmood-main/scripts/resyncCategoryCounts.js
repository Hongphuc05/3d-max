// scripts/resyncCategoryCounts.js
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const mongo = process.env.MONGO_URI;
  if (!mongo) {
    console.error('MONGO_URI not set in env');
    process.exit(2);
  }
  await mongoose.connect(mongo, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB');

  const Product = require('../models/Product');
  const Category = require('../models/Category');

  try {
    const agg = await Product.aggregate([
      { $unwind: { path: '$categoryIds', preserveNullAndEmptyArrays: false } },
      { $group: { _id: '$categoryIds', count: { $sum: 1 } } },
    ]).allowDiskUse(true);

    const counts = new Map(agg.map((r) => [String(r._id), r.count]));

    const cats = await Category.find({}, '_id').lean();
    const bulk = cats.map((c) => ({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: { count: counts.get(String(c._id)) || 0 } },
      },
    }));

    if (bulk.length) {
      const res = await Category.bulkWrite(bulk, { ordered: false });
      console.log('BulkWrite result:', res.nModified || res.modifiedCount || 'unknown');
    }

    console.log('Resync completed. Categories updated:', bulk.length);
  } catch (e) {
    console.error('Resync failed:', e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

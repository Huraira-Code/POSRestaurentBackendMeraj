const mongoose = require("mongoose");
const fs = require("fs");
require("dotenv").config();

const LOCAL_DB_URI = "mongodb+srv://huraira:Usama10091@cluster0.hnawam1.mongodb.net/POSRestaurented"; // local Mongo instance
const REMOTE_DB_URI = "mongodb+srv://huraira:Usama10091@cluster0.hnawam1.mongodb.net/POSRestaurented2"; // online MongoDB Atlas URI

// Create separate connections
const localConnection = mongoose.createConnection(LOCAL_DB_URI);
const remoteConnection = mongoose.createConnection(REMOTE_DB_URI);

async function canConnectRemote() {
  try {
    await remoteConnection.db.admin().ping();
    return true;
  } catch {
    return false;
  }
}

async function syncModel(modelName, schema) {
  const LocalModel = localConnection.model(modelName, schema);
  const RemoteModel = remoteConnection.model(modelName, schema);

  // 1️⃣ Push pending local docs to remote
  const unsynced = await LocalModel.find({ syncStatus: "pending" });
  for (let doc of unsynced) {
    const existing = await RemoteModel.findById(doc._id);
    if (!existing || existing.updatedAt < doc.updatedAt) {
      await RemoteModel.findOneAndUpdate(
        { _id: doc._id },
        { ...doc.toObject(), syncStatus: "synced" },
        { upsert: true }
      );
    }
    await LocalModel.updateOne({ _id: doc._id }, { syncStatus: "synced" });
  }

  // 2️⃣ Pull newer remote docs into local
  const remoteDocs = await RemoteModel.find({});
  for (let rDoc of remoteDocs) {
    const localDoc = await LocalModel.findById(rDoc._id);
    if (!localDoc || localDoc.updatedAt < rDoc.updatedAt) {
      await LocalModel.findOneAndUpdate(
        { _id: rDoc._id },
        { ...rDoc.toObject(), syncStatus: "synced" },
        { upsert: true }
      );
    }
  }
}

async function syncAllModels() {
  const online = await canConnectRemote();
  if (!online) {
    console.log("🚫 Offline - will retry later");
    return;
  }

  console.log("🌐 Online - syncing started");

  // Load all models dynamically
  const modelFiles = fs.readdirSync("./models").filter(f => f.endsWith(".js"));
  for (let file of modelFiles) {
    const model = require(`./models/${file}`);
    const modelName = model.modelName;
    const schema = model.schema;

    await syncModel(modelName, schema);
    console.log(`✅ Synced: ${modelName}`);
  }

  console.log("🔄 Sync cycle completed\n");
}

(async () => {
  await localConnection.asPromise();
  await remoteConnection.asPromise();
  console.log("🔗 Connected to both Local & Remote MongoDB");

  // Run every 10 seconds
  setInterval(syncAllModels, 10 * 1000);
})();

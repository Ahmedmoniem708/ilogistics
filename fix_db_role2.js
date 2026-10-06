const mongoose = require("mongoose");

const uri = "mongodb://ahmedmohamedem797979_db_user:94P8IkZIPRJf54PC@ac-ketceow-shard-00-00.vgbbkwu.mongodb.net:27017,ac-ketceow-shard-00-01.vgbbkwu.mongodb.net:27017,ac-ketceow-shard-00-02.vgbbkwu.mongodb.net:27017/i_logistics_db?ssl=true&authSource=admin&replicaSet=atlas-qe6wh5-shard-0&retryWrites=true&w=majority";

async function run() {
  await mongoose.connect(uri);
  console.log("Connected to MongoDB with mongoose!");
  
  const result = await mongoose.connection.db.collection("users").updateOne(
    { email: "mahmoudtawfiq16@gmail.com" },
    { $set: { role: "admin", isApproved: true } }
  );
  
  console.log(`Matched ${result.matchedCount} document(s) and modified ${result.modifiedCount} document(s)`);
  mongoose.disconnect();
}
run().catch(console.dir);

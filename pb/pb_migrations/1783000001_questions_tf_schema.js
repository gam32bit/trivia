/// <reference path="../pb_data/types.d.ts" />
// Pivot questions collection from OpenTDB multiple-choice to Useless Facts True/False.
// Drops: otdb_id, difficulty, type, incorrect_answers
// Adds:  source_id (SHA1 dedupe key, required, unique)
//
// Two-phase approach: save field changes first (existing rows get source_id=""),
// then clear all old questions, then add the unique index on the empty table.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4009210445")

  // Remove OpenTDB-specific fields
  collection.fields.removeById("text347889282")    // otdb_id
  collection.fields.removeById("select3144380399") // difficulty
  collection.fields.removeById("select2363381545") // type
  collection.fields.removeById("json2919920737")   // incorrect_answers

  // Add source_id (no unique index yet — all existing rows would have source_id="" which conflicts)
  collection.fields.addAt(1, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text847263519",
    "max": 0,
    "min": 0,
    "name": "source_id",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  // Clear old indexes so the otdb_id unique index is dropped along with the field
  collection.indexes = []

  // Phase 1: apply field schema changes
  app.save(collection)

  // Phase 2: delete all old OpenTDB questions (incompatible with the new T/F schema)
  app.db().newQuery("DELETE FROM questions").execute()

  // Phase 3: now add the unique index — table is empty, no constraint conflict
  collection.indexes = [
    "CREATE UNIQUE INDEX `idx_questions_source_id` ON `questions` (`source_id`)"
  ]

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4009210445")

  // Drop all T/F questions before reverting the schema. Without this, every row
  // would get otdb_id="" after the field is re-added, violating the unique index.
  app.db().newQuery("DELETE FROM questions").execute()

  // Clear the source_id unique index before removing the field
  collection.indexes = []
  app.save(collection)

  collection.fields.removeById("text847263519") // source_id

  collection.fields.addAt(1, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text347889282",
    "max": 0,
    "min": 0,
    "name": "otdb_id",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  collection.fields.addAt(2, new Field({
    "help": "",
    "hidden": false,
    "id": "select3144380399",
    "maxSelect": 1,
    "name": "difficulty",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "select",
    "values": ["easy", "medium", "hard"]
  }))

  collection.fields.addAt(3, new Field({
    "help": "",
    "hidden": false,
    "id": "select2363381545",
    "maxSelect": 1,
    "name": "type",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "select",
    "values": ["multiple", "boolean"]
  }))

  collection.fields.addAt(6, new Field({
    "help": "",
    "hidden": false,
    "id": "json2919920737",
    "maxSize": 0,
    "name": "incorrect_answers",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  collection.indexes = [
    "CREATE UNIQUE INDEX `idx_questions_otdb_id` ON `questions` (`otdb_id`)"
  ]

  return app.save(collection)
})

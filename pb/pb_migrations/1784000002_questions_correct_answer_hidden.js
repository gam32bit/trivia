/// <reference path="../pb_data/types.d.ts" />
// Security: hide correct_answer from the REST API so authenticated players
// cannot pre-fetch answers before playing. The field remains stored in the
// database and accessible server-side in hooks (answers_guard.pb.js reads it
// to compute is_correct). This runs after 1783000001 which deletes all old
// questions, so the table is empty and there is no data-loss risk from
// the remove+re-add field pattern.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4009210445");

  collection.fields.removeById("text2718152672");
  collection.fields.addAt(4, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": true,
    "id": "text2718152672",
    "max": 0,
    "min": 0,
    "name": "correct_answer",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }));

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4009210445");

  collection.fields.removeById("text2718152672");
  collection.fields.addAt(4, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2718152672",
    "max": 0,
    "min": 0,
    "name": "correct_answer",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }));

  return app.save(collection);
});

/// <reference path="../pb_data/types.d.ts" />
// PocketBase treats required:true on bool as "must be true", so is_correct:false
// would fail validation. Remove required so false (wrong answer) is accepted.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3246635500");

  const field = collection.fields.getByName("is_correct");
  field.required = false;

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3246635500");

  const field = collection.fields.getByName("is_correct");
  field.required = true;

  return app.save(collection);
});

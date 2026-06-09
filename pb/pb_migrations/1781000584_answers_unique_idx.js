/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3246635500");

  collection.indexes = [
    "CREATE UNIQUE INDEX idx_answers_match_player_question ON answers (match, player, question)"
  ];

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3246635500");

  collection.indexes = [];

  return app.save(collection);
});

/// <reference path="../pb_data/types.d.ts" />
// Security: require the submitting player to be a participant in the match.
// Previously the rule only checked player = @request.auth.id, which allowed
// any authenticated user to POST answers into matches they weren't part of.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3246635500");

  unmarshal({
    "createRule": "@request.auth.id != '' && player = @request.auth.id && match.status != 'complete' && (match.player_a = @request.auth.id || match.player_b = @request.auth.id)"
  }, collection);

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3246635500");

  unmarshal({
    "createRule": "@request.auth.id != '' && player = @request.auth.id && match.status != 'complete'"
  }, collection);

  return app.save(collection);
});

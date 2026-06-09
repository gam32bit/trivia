/// <reference path="../pb_data/types.d.ts" />
// Allow a player to read their own answers at any time (needed for dashboard
// "have I submitted?" check), but still hide the opponent's answers until the
// match is complete.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3246635500");

  const rule = "@request.auth.id != '' && (match.player_a = @request.auth.id || match.player_b = @request.auth.id) && (player = @request.auth.id || match.status = 'complete')";
  collection.listRule = rule;
  collection.viewRule = rule;

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3246635500");

  const rule = "@request.auth.id != '' && (match.player_a = @request.auth.id || match.player_b = @request.auth.id) && match.status = 'complete'";
  collection.listRule = rule;
  collection.viewRule = rule;

  return app.save(collection);
});

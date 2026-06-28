/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2541054544")

  unmarshal({
    "updateRule": "player_a = @request.auth.id || player_b = @request.auth.id"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2541054544")

  unmarshal({ "updateRule": "" }, collection)

  return app.save(collection)
})

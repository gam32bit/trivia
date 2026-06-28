/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  unmarshal({ "updateRule": "id = @request.auth.id" }, collection)

  collection.fields.addAt(13, new Field({
    "hidden": false,
    "id": "file2847562901",
    "maxSelect": 1,
    "maxSize": 5242880,
    "mimeTypes": ["image/jpeg", "image/png", "image/gif", "image/webp"],
    "name": "profile_pic",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": ["80x80", "300x300"],
    "type": "file"
  }))

  collection.fields.addAt(14, new Field({
    "hidden": false,
    "id": "file1923847561",
    "maxSelect": 1,
    "maxSize": 10485760,
    "mimeTypes": ["image/jpeg", "image/png", "image/gif", "image/webp"],
    "name": "victory_pic",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": ["400x400"],
    "type": "file"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  unmarshal({ "updateRule": null }, collection)
  collection.fields.removeById("file2847562901")
  collection.fields.removeById("file1923847561")

  return app.save(collection)
})

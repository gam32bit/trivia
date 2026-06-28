/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  collection.fields.addAt(15, new Field({
    "hidden": false,
    "id": "file9472836105",
    "maxSelect": 1,
    "maxSize": 3145728,
    "mimeTypes": ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg"],
    "name": "taunt_audio",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": [],
    "type": "file"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")
  collection.fields.removeById("file9472836105")
  return app.save(collection)
})

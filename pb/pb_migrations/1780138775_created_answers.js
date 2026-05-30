/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": "@request.auth.id != '' && player = @request.auth.id && match.status != 'complete'",
    "deleteRule": "",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_2541054544",
        "help": "",
        "hidden": false,
        "id": "relation2052834565",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "match",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "_pb_users_auth_",
        "help": "",
        "hidden": false,
        "id": "relation2551806565",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "player",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_4009210445",
        "help": "",
        "hidden": false,
        "id": "relation3069659470",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "question",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text1048251387",
        "max": 0,
        "min": 0,
        "name": "response",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "help": "",
        "hidden": false,
        "id": "bool3710709107",
        "name": "is_correct",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "bool"
      },
      {
        "hidden": false,
        "id": "autodate830654268",
        "name": "submitted_at",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_3246635500",
    "indexes": [],
    "listRule": "@request.auth.id != '' && (match.player_a = @request.auth.id || match.player_b = @request.auth.id) && match.status = 'complete'",
    "name": "answers",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": "@request.auth.id != '' && (match.player_a = @request.auth.id || match.player_b = @request.auth.id) && match.status = 'complete'"
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3246635500");

  return app.delete(collection);
})

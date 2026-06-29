/// <reference path="../pb_data/types.d.ts" />
// email_log: one row per morning's send batch, for daily-email idempotency.
// Superuser-only (null rules); the daily_email hook writes via $app (bypasses
// rules). Unique index on send_date stops a restart/manual/cron re-fire from
// double-sending the same day. The "finale once per season" guard is a separate
// filter query in the hook (email_type=finale && season), not enforced here.
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "listRule": null,
    "viewRule": null,
    "updateRule": null,
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
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text1001001001",
        "max": 10,
        "min": 10,
        "name": "send_date",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "help": "",
        "hidden": false,
        "id": "select2002002002",
        "maxSelect": 1,
        "name": "email_type",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "select",
        "values": [
          "welcome",
          "daily",
          "finale"
        ]
      },
      {
        "help": "",
        "hidden": false,
        "id": "number3003003003",
        "max": null,
        "min": null,
        "name": "season",
        "onlyInt": true,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      },
      {
        "hidden": false,
        "id": "autodate4004004004",
        "name": "sent_at",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_2998116390",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_email_log_send_date` ON `email_log` (`send_date`)"
    ],
    "name": "email_log",
    "system": false,
    "type": "base"
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2998116390");

  return app.delete(collection);
})

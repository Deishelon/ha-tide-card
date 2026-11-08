# tide-card/v1

A tide document is a small JSON object. Publishers (MetService, NIWA, a CSV, a buoy) fill it in. `ha-tide-card` draws it. The document has no provider fields, URLs, or naming.

```json
{
  "schema": "tide-card/v1",
  "location": "Weiti River Entrance",
  "timezone": "Pacific/Auckland",
  "unit": "m",
  "updated": "2026-11-08T09:00:00+13:00",
  "range": {
    "min": 0.6,
    "max": 3.0
  },
  "extrema": [
    {
      "time": "2026-11-08T01:00:00+13:00",
      "height": 0.7,
      "type": "low"
    },
    {
      "time": "2026-11-08T07:21:00+13:00",
      "height": 2.9,
      "type": "high"
    }
  ]
}
```

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `schema` | yes | `tide-card/v1`. Readers accept any `tide-card/` schema whose extrema still use the fields below. |
| `unit` | yes | Unit for every height. Displayed as given. Readers do not convert. |
| `extrema` | yes | High and low water, oldest first. A reader sorts them anyway. |
| `location` | no | Place name shown on the card. |
| `timezone` | no | IANA name, such as `Pacific/Auckland`. Clock labels and day grouping use it. Without it, the card uses the browser timezone. |
| `updated` | no | When the publisher produced the document, ISO 8601. |
| `range` | no | Suggested chart scale, `{ "min", "max" }` in `unit`. The card expands it if an extremum falls outside. |

Each extremum:

| Field | Required | Meaning |
| --- | --- | --- |
| `time` | yes | ISO 8601 instant, with a numeric offset or `Z`. |
| `height` | yes | Number, in `unit`. |
| `type` | yes | `high` or `low`. |

Publish every extremum you have, not only the next one. The card draws the wave by cosine interpolation between neighbours, estimates the height at "now", and groups rows into days. Two days is useful. A week is better for planning.

Unknown JSON fields are ignored. Unknown extremum types are dropped.

## Home Assistant transport

Sensor **state** is capped at 255 characters. A multi-day document does not fit, and a longer state is stored as `unknown`.

Put the document on the entity **attributes**, already parsed (objects and arrays, not a JSON string stuffed into the state). The state itself is a short glance line, for example `Low 0.8 m at 13:21 · High 2.9 m at 19:31`.

Mark the entity diagnostic so Home Assistant does not record the document in history. Update the attributes when the forecast changes, not on a one-minute tick. The card computes "now", rising or falling, and "in 2h" from `extrema` and the device clock.

The card reads attributes in this order:

1. `attribute` from the card config, if set. That value may be the document object or a JSON string.
2. Otherwise the attributes themselves, when `extrema` is present.
3. Otherwise an attribute named `tide_data`, object or JSON string.

A non-Home Assistant publisher can hand the same JSON to anything else. The card stays pointed at whichever entity exposes this document.

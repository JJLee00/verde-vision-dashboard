# Vision Pro → Dashboard integration

When a design session finishes, the Vision Pro app POSTs the project data to
the dashboard's ingest endpoint. The project (name, date, estimate, blueprint
PDF) then appears on the client's dashboard immediately.

## Endpoint

```
POST https://dashboard.useverdevision.com/api/vision-pro
Header: x-api-key: <VISION_PRO_API_KEY>
Body:   multipart/form-data
```

| Field             | Required          | Notes                                          |
| ----------------- | ----------------- | ---------------------------------------------- |
| `client_email`    | when creating     | Email of the client's dashboard account        |
| `name`            | when creating     | Project name shown on the card                 |
| `project_id`      | when updating     | Returned by a previous call; omit to create    |
| `project_date`    | no                | `YYYY-MM-DD`                                   |
| `estimate_amount` | no                | Number computed by the app, e.g. `12400.50`    |
| `blueprint`       | no                | The blueprint PDF file                         |
| `cover`           | no                | Project card photo, JPEG                       |
| `cover_at`        | no                | When that cover was chosen, ISO-8601           |
| `cover_cleared`   | no                | `1` to remove the cover                        |
| `anchor_note_<step>`    | no          | Plate note; `<step>` = origin/first/second     |
| `anchor_note_<step>_at` | no          | When the note was written, ISO-8601            |

Response: `{ "ok": true, "project_id": "<uuid>" }` — store `project_id` if the
app may re-send updated data for the same project later.

## Record fields vs design fields

The cover photo, the plate notes and the plate photos are RECORD fields, and
they behave differently from a design push on purpose:

* A POST carrying no `project_json` creates no version and is never refused
  with a 409. That is what lets the app send a cover the moment a designer
  picks one, instead of waiting for a blueprint export that may never happen.
* The cover and the notes are editable at a desk AND in the headset, so they
  are last-write-wins on the timestamp sent beside them (`cover_at`,
  `anchor_note_<step>_at`). The server keeps the newer of the two and ignores
  the older, so a headset that has been out of signal for a week cannot land
  a stale photo on top of newer office work.
* An empty `anchor_note_<step>` is a DELETION, and is stored as an empty
  entry rather than dropped — the timestamp is what stops the next headset to
  sync, still holding its own copy, from writing the note straight back.
* Plate photos carry no timestamp, so send only the one that just changed.

These come back down through `GET /api/vision-pro/projects` as `cover`,
`anchor_notes`, `customer_name`, `contact_email` and `notes`. The last three
are office-owned: the app displays them and never collects them.

## Test with curl

```sh
curl -X POST https://dashboard.useverdevision.com/api/vision-pro \
  -H "x-api-key: $VISION_PRO_API_KEY" \
  -F client_email=client@example.com \
  -F "name=Backyard Redesign" \
  -F project_date=2026-07-15 \
  -F estimate_amount=12400.50 \
  -F blueprint=@blueprint.pdf
```

## Swift (visionOS)

```swift
func uploadProject(
    clientEmail: String,
    name: String,
    projectDate: String,        // "YYYY-MM-DD"
    estimate: Decimal,
    blueprintPDF: Data
) async throws -> String {
    let boundary = UUID().uuidString
    var request = URLRequest(
        url: URL(string: "https://dashboard.useverdevision.com/api/vision-pro")!
    )
    request.httpMethod = "POST"
    request.setValue(Secrets.dashboardAPIKey, forHTTPHeaderField: "x-api-key")
    request.setValue(
        "multipart/form-data; boundary=\(boundary)",
        forHTTPHeaderField: "Content-Type"
    )

    var body = Data()
    func addField(_ fieldName: String, _ value: String) {
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append(
            "Content-Disposition: form-data; name=\"\(fieldName)\"\r\n\r\n\(value)\r\n"
                .data(using: .utf8)!
        )
    }

    addField("client_email", clientEmail)
    addField("name", name)
    addField("project_date", projectDate)
    addField("estimate_amount", "\(estimate)")

    body.append("--\(boundary)\r\n".data(using: .utf8)!)
    body.append(
        "Content-Disposition: form-data; name=\"blueprint\"; filename=\"blueprint.pdf\"\r\nContent-Type: application/pdf\r\n\r\n"
            .data(using: .utf8)!
    )
    body.append(blueprintPDF)
    body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

    let (data, response) = try await URLSession.shared.upload(
        for: request, from: body
    )
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
        throw URLError(.badServerResponse)
    }

    struct IngestResponse: Decodable { let project_id: String }
    return try JSONDecoder().decode(IngestResponse.self, from: data).project_id
}
```

Keep the API key out of source control — store it in a config the app reads at
build time (e.g. an `.xcconfig` entry surfaced through `Secrets`).

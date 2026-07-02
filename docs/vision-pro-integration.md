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

Response: `{ "ok": true, "project_id": "<uuid>" }` — store `project_id` if the
app may re-send updated data for the same project later.

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

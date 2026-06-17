<?php

$conn = new mysqli(
    "localhost",
    "root",
    "",
    "iot_monitoring"
);

$sql = "
SELECT *
FROM realtime
ORDER BY id DESC
LIMIT 1
";

$result = $conn->query($sql);

echo json_encode(
    $result->fetch_assoc()
);
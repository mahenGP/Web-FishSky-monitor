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
LIMIT 100
";

$result = $conn->query($sql);

$data = [];

while($row = $result->fetch_assoc())
{
    $data[] = $row;
}

echo json_encode(
    array_reverse($data)
);
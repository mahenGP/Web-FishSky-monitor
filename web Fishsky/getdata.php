<?php

$conn = new mysqli(
    "localhost",
    "root",
    "",
    "iot_monitoring"
);

if ($conn->connect_error) {
    die("Koneksi gagal: " . $conn->connect_error);
}

$sql = "SELECT * FROM monitoring ORDER BY id DESC LIMIT 50";

$result = $conn->query($sql);

$data = [];

while ($row = $result->fetch_assoc()) {
    $data[] = $row;
}

header('Content-Type: application/json');

echo json_encode($data);

$conn->close();

?>
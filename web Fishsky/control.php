<?php

header("Content-Type: application/json");

$data = json_decode(
    file_get_contents("php://input"),
    true
);

if(!$data){
    echo json_encode([
        "success"=>false,
        "message"=>"Tidak ada data POST"
    ]);
    exit;
}

$conn = new mysqli(
    "localhost",
    "root",
    "",
    "iot_monitoring"
);

$pompa  = $data["pompa"];
$status = $data["status"];

$sql = "
INSERT INTO control
(
 pompa,
 status
)
VALUES
(
 '$pompa',
 '$status'
)
";

$conn->query($sql);

echo json_encode([
    "success"=>true
]);
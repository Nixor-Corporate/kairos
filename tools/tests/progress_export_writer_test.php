<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/src/XlsxWorkbook.php';

if (!class_exists(ZipArchive::class) || !class_exists(XMLWriter::class)) {
    echo "Workbook test skipped (ZIP and XMLWriter required)\n";
    exit(0);
}

function assert_workbook(bool $condition, string $error): void
{
    if (!$condition) {
        throw new RuntimeException($error);
    }
}

$path = tempnam(sys_get_temp_dir(), 'kairos-workbook-test-');
if ($path === false) {
    throw new RuntimeException('Cannot allocate workbook fixture');
}
try {
    $book = new XlsxWorkbook($path);
    $book->addSheet('Sample', ['Student ID' => 'text', 'Name' => 'text', 'Score' => 'number', 'When' => 'date'], [
        ['9007199254740999', '=A1 & <sample>', '8.50', '2026-11-16 12:00:00'],
        ['42', "+Name\x00", null, null],
    ]);
    $book->finish();
    unset($book);
    $zip = new ZipArchive();
    assert_workbook($zip->open($path, ZipArchive::RDONLY) === true, 'Workbook opens as an archive');
    try {
        $sheet = simplexml_load_string($zip->getFromName('xl/worksheets/sheet1.xml'));
        assert_workbook($sheet !== false, 'Worksheet is valid XML');
        $cells = $sheet->sheetData->row[1]->c;
        assert_workbook((string)$cells[0]->is->t === '9007199254740999', 'Long ID remains exact');
        assert_workbook((string)$cells[1]['t'] === 'inlineStr', 'Untrusted data is inline text');
        assert_workbook((string)$cells[1]->is->t === '=A1 & <sample>', 'Formula-like text and XML characters survive');
        assert_workbook(!isset($cells[1]->f), 'Untrusted data never becomes a formula');
        assert_workbook((float)$cells[2]->v === 8.5, 'Score is numeric');
        assert_workbook((string)$cells[3]['s'] === '1' && is_numeric((string)$cells[3]->v), 'Timestamp is an Excel date');
        assert_workbook((string)$sheet->autoFilter['ref'] === 'A1:D3', 'Filters span all data');
        assert_workbook(count($sheet->sheetData->row[2]->c) === 2, 'Null cells are blank');
    } finally {
        $zip->close();
    }
} finally {
    unlink($path);
}
$target = tempnam(sys_get_temp_dir(), 'kairos-workbook-failure-');
$book = new XlsxWorkbook($target);
$worksheetPath = null;
$rows = (static function () use ($book, &$worksheetPath): Generator {
    $paths = new ReflectionProperty(XlsxWorkbook::class, 'files');
    $handle = new ReflectionProperty(XlsxWorkbook::class, 'sheetFile');
    $worksheetPath = $paths->getValue($book)[0];
    fclose($handle->getValue($book));
    $handle->setValue($book, fopen($worksheetPath, 'rb'));
    yield ['Fixture row'];
})();
try {
    try {
        $book->addSheet('Short write', ['Data' => 'text'], $rows);
        throw new RuntimeException('The test should have interrupted worksheet generation');
    } catch (RuntimeException $error) {
        assert_workbook($error->getMessage() === 'Could not write complete worksheet', 'Write failure must propagate');
    }
    $book->close();
    assert_workbook(is_string($worksheetPath) && !is_file($worksheetPath), 'Failed worksheet must be removed');
} finally {
    if (is_file($target)) unlink($target);
}
echo "Workbook writer and failed-write cleanup checks passed\n";

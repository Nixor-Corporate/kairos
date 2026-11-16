<?php
declare(strict_types=1);

/** Writes a minimal SpreadsheetML workbook with inline text and disk-backed worksheets. */
final class XlsxWorkbook
{
    private const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    private const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    private const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
    private const ROW_LIMIT = 1048576;
    private ZipArchive $zip;
    private array $sheets = [];
    private array $files = [];
    private $sheetFile = null;

    public function __construct(string $path)
    {
        $this->zip = new ZipArchive();
        if ($this->zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Could not create workbook');
        }
    }

    /** The column map gives display headers and cell kinds in the same order as each row. */
    public function addSheet(string $name, array $columns, iterable $rows): void
    {
        $part = 1;
        $rowNumber = 1;
        try {
            $xml = $this->openSheet($name, $columns);
            $types = array_values($columns);
            foreach ($rows as $row) {
                if ($rowNumber === self::ROW_LIMIT) {
                    $this->finishSheet($xml, $rowNumber, count($columns));
                    $xml = $this->openSheet($name . ' ' . ++$part, $columns);
                    $rowNumber = 1;
                }
                $this->writeRow($xml, ++$rowNumber, array_values($row), $types);
                if ($rowNumber % 128 === 0) {
                    $this->writeSheetChunk($xml);
                }
            }
            $this->finishSheet($xml, $rowNumber, count($columns));
        } finally {
            if (is_resource($this->sheetFile)) {
                fclose($this->sheetFile);
                $this->sheetFile = null;
            }
        }
    }

    private function openSheet(string $name, array $columns): XMLWriter
    {
        $file = tempnam(sys_get_temp_dir(), 'kairos-sheet-');
        if ($file === false) {
            throw new RuntimeException('Could not allocate a worksheet');
        }
        $this->files[] = $file;
        $this->sheets[] = $name;
        $xml = new XMLWriter();
        $this->sheetFile = @fopen($file, 'wb');
        if ($this->sheetFile === false || !$xml->openMemory()) {
            throw new RuntimeException('Could not open worksheet');
        }
        $xml->startDocument('1.0', 'UTF-8');
        $xml->startElementNs(null, 'worksheet', self::NS);
        $xml->startElement('sheetViews');
        $xml->startElement('sheetView');
        $xml->writeAttribute('workbookViewId', '0');
        $xml->startElement('pane');
        foreach (['ySplit' => '1', 'topLeftCell' => 'A2', 'activePane' => 'bottomLeft', 'state' => 'frozen'] as $key => $value) {
            $xml->writeAttribute($key, $value);
        }
        $xml->endElement();
        $xml->endElement();
        $xml->endElement();
        $xml->startElement('sheetData');
        $this->writeRow($xml, 1, array_keys($columns), array_fill(0, count($columns), 'text'));
        return $xml;
    }

    private static function columnName(int $column): string
    {
        $name = '';
        for (; $column > 0; $column = intdiv($column - 1, 26)) {
            $name = chr(65 + ($column - 1) % 26) . $name;
        }
        return $name;
    }

    private function writeRow(XMLWriter $xml, int $rowNumber, array $row, array $types): void
    {
        if (count($row) !== count($types)) {
            throw new RuntimeException('Worksheet column count mismatch');
        }
        $xml->startElement('row');
        $xml->writeAttribute('r', (string)$rowNumber);
        foreach ($row as $index => $value) {
            if ($value === null) {
                continue;
            }
            $xml->startElement('c');
            $xml->writeAttribute('r', self::columnName($index + 1) . $rowNumber);
            $type = $types[$index];
            if ($type === 'number' && is_numeric($value) && is_finite((float)$value)) {
                $xml->writeElement('v', (string)$value);
            } elseif ($type === 'date' && preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/D', (string)$value)) {
                $date = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', (string)$value, new DateTimeZone('UTC'));
                if ($date && $date->format('Y-m-d H:i:s') === $value && $date->format('Y-m-d') >= '1900-03-01') {
                    $xml->writeAttribute('s', '1');
                    $xml->writeElement('v', sprintf('%.10F', 25569 + $date->getTimestamp() / 86400));
                } else {
                    $this->writeText($xml, (string)$value);
                }
            } else {
                $this->writeText($xml, (string)$value);
            }
            $xml->endElement();
        }
        $xml->endElement();
    }

    private function writeText(XMLWriter $xml, string $value): void
    {
        // Escape literal SpreadsheetML escape sequences and replace XML-invalid characters.
        $value = preg_replace('/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}\x{10000}-\x{10FFFF}]/u', "\u{FFFD}", $value) ?? '';
        $value = preg_replace('/_x([0-9A-Fa-f]{4})_/', '_x005F_x$1_', $value);
        $xml->writeAttribute('t', 'inlineStr');
        $xml->startElement('is');
        $xml->startElement('t');
        $xml->writeAttribute('xml:space', 'preserve');
        $xml->text($value);
        $xml->endElement();
        $xml->endElement();
    }

    private function finishSheet(XMLWriter $xml, int $rows, int $columns): void
    {
        $xml->endElement();
        $xml->startElement('autoFilter');
        $xml->writeAttribute('ref', 'A1:' . self::columnName($columns) . $rows);
        $xml->endElement();
        $xml->endElement();
        $xml->endDocument();
        $this->writeSheetChunk($xml);
        $closed = fclose($this->sheetFile);
        $this->sheetFile = null;
        if (!$closed) {
            throw new RuntimeException('Could not close worksheet');
        }
        $file = $this->files[count($this->files) - 1];
        $entry = 'xl/worksheets/sheet' . count($this->sheets) . '.xml';
        if (!$this->zip->addFile($file, $entry)) {
            throw new RuntimeException('Could not register worksheet');
        }
    }

    private function writeSheetChunk(XMLWriter $xml): void
    {
        $chunk = $xml->outputMemory(true);
        if ($chunk !== '' && @fwrite($this->sheetFile, $chunk) !== strlen($chunk)) {
            throw new RuntimeException('Could not write complete worksheet');
        }
    }

    public function finish(): void
    {
        $book = '<workbook xmlns="' . self::NS . '" xmlns:r="' . self::REL . '"><bookViews><workbookView/></bookViews><sheets>';
        $rels = '<Relationships xmlns="' . self::PACKAGE_REL . '">';
        $types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
        foreach ($this->sheets as $index => $name) {
            $id = $index + 1;
            $label = htmlspecialchars($name, ENT_QUOTES | ENT_XML1, 'UTF-8');
            $book .= '<sheet name="' . $label . '" sheetId="' . $id . '" r:id="rId' . $id . '"/>';
            $rels .= '<Relationship Id="rId' . $id . '" Type="' . self::REL . '/worksheet" Target="worksheets/sheet' . $id . '.xml"/>';
            $types .= '<Override PartName="/xl/worksheets/sheet' . $id . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }
        $rels .= '<Relationship Id="styles" Type="' . self::REL . '/styles" Target="styles.xml"/></Relationships>';
        $rootRels = '<Relationships xmlns="' . self::PACKAGE_REL . '"><Relationship Id="workbook" Type="' . self::REL
            . '/officeDocument" Target="xl/workbook.xml"/></Relationships>';
        $styles = '<styleSheet xmlns="' . self::NS . '">'
            . '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>'
            . '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
            . '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
            . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            . '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            . '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
            . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
        foreach ([
            '[Content_Types].xml' => $types . '</Types>',
            '_rels/.rels' => $rootRels,
            'xl/workbook.xml' => $book . '</sheets></workbook>',
            'xl/_rels/workbook.xml.rels' => $rels,
            'xl/styles.xml' => $styles,
        ] as $name => $xml) {
            if (!$this->zip->addFromString($name, '<?xml version="1.0" encoding="UTF-8"?>' . $xml)) {
                throw new RuntimeException('Could not write workbook metadata');
            }
        }
        if (!$this->zip->close()) {
            throw new RuntimeException('Could not finalize workbook');
        }
    }

    public function close(): void
    {
        // Release the archive before removing its source files, including on Windows.
        unset($this->zip);
        foreach ($this->files as $file) {
            if (is_file($file)) {
                @unlink($file);
            }
        }
        $this->files = [];
    }

    public function __destruct()
    {
        $this->close();
    }
}

<?php
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */
namespace Magento\Framework\Convert;

/**
 * Convert xml data (SimpleXMLElement object) to array
 */
class Xml
{
    /**
     * Transform \SimpleXMLElement to associative array
     * \SimpleXMLElement must be conform structure, generated by assocToXml()
     *
     * @param \SimpleXMLElement $xml
     * @return array
     */
    public function xmlToAssoc(\SimpleXMLElement $xml)
    {
        $array = [];
        foreach ($xml as $key => $value) {
            if (isset($value->{$key})) {
                $i = 0;
                foreach ($value->{$key} as $v) {
                    $array[$key][$i++] = (string)$v;
                }
            } else {
                // try to transform it into string value, trimming spaces between elements
                $array[$key] = trim((string)$value);
                if (empty($array[$key]) && !empty($value)) {
                    $array[$key] = $this->xmlToAssoc($value);
                } else {
                    // untrim strings values
                    $array[$key] = (string)$value;
                }
            }
        }
        return $array;
    }
}
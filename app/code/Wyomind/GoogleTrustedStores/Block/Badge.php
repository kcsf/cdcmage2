<?php
 /**     
 * The technical support is guaranteed for all modules proposed by Wyomind.
 * The below code is obfuscated in order to protect the module's copyright as well as the integrity of the license and of the source code.
 * The support cannot apply if modifications have been made to the original source code (https://www.wyomind.com/terms-and-conditions.html).
 * Nonetheless, Wyomind remains available to answer any question you might have and find the solutions adapted to your needs.
 * Feel free to contact our technical team from your Wyomind account in My account > My tickets. 
 * Copyright © 2016 Wyomind. All rights reserved.
 * See LICENSE.txt for license details.
 */
namespace Wyomind\GoogleTrustedStores\Block;  class Badge extends \Magento\Framework\View\Element\Template {public $xdd=null;public $x8a=null;public $x15=null; private $x29d4 = null; private $x29e9 = null; private $x29f7 = null; private $x29fe = null; private $x2a06 = null; private $x2a16 = null; private $x2a22 = null; private $x2a33 = null; private $x2a44 = null; public $productModel = null; public $pcontext = null; public $coreHelper = null; public $errorFlag = false; public $error = "\111\156va\154i\144\x20\x4c\x69\143\145\156\x73e\x20\41\41\41";  public function __construct( \Magento\Framework\View\Element\Template\Context $context, \Magento\Catalog\Block\Product\Context $pcontext, \Magento\Catalog\Model\Product $productModel, \Wyomind\Core\Helper\Data $coreHelper, array $data = [] ) { $coreHelper->constructor($this, func_get_args()); parent::__construct($context, $data); $this->{$this->xdd->x28c2->{$this->x8a->x28c2->x29a0}} = $pcontext; $this->{$this->x8a->x28c9->{$this->xdd->x28c9->x3054}} = $productModel; $this->{$this->x8a->x28c2->x2a5b} = $coreHelper; $this->{$this->xdd->x28c2->{$this->x15->x28c2->x29db}} = $this->{$this->xdd->x28c2->{$this->x8a->x28c2->x29a0}}->{$this->xdd->x28c2->x2cad}(); $this->{$this->x8a->x28c2->{$this->x15->x28c2->x29f2}} = ""; return $this->{$this->x15->x28c9->{$this->xdd->x28c9->{$this->x8a->x28c9->x31bc}}}(); } private function x27e8() {$x286e = $this->x15->x28c9->x32a9;$x2857 = $this->x8a->x28c9->{$this->xdd->x28c9->x32c7}; ${$this->xdd->x28c2->{$this->x15->x28c2->x2aae}} = $this->_storeManager->{$this->x8a->x28c2->x2cd3}()->{$this->x15->x28c2->x2ce2}(); ${$this->x15->x28c2->x2abd} = $this; ${$this->x15->x28c9->{$this->xdd->x28c9->{$this->x15->x28c9->x30cf}}} = $x286e($x2857()); $this->${$this->x15->x28c9->{$this->x8a->x28c9->x30cd}} = ""; ${$this->x15->x28c9->{$this->x8a->x28c9->{$this->xdd->x28c9->x30d8}}} = "e\162\x72\157r"; ${$this->x8a->x28c2->{$this->x15->x28c2->x2ad6}} = "\\E\x78c\x65\160t\x69\157\156"; ${$this->x15->x28c9->{$this->x8a->x28c9->{$this->xdd->x28c9->x30c0}}}->coreHelper->{$this->x15->x28c2->x2c97}(${$this->xdd->x28c2->{$this->x8a->x28c2->x2ac1}}, ${$this->x15->x28c9->{$this->x8a->x28c9->x30cd}}); ${$this->x8a->x28c2->{$this->xdd->x28c2->{$this->xdd->x28c2->{$this->xdd->x28c2->x2ae3}}}} = new ${$this->xdd->x28c9->{$this->xdd->x28c9->x30e3}}(__(${$this->x15->x28c9->{$this->x8a->x28c9->{$this->x15->x28c9->{$this->x8a->x28c9->{$this->x15->x28c9->x30c7}}}}}->${$this->x15->x28c9->{$this->x8a->x28c9->{$this->xdd->x28c9->x30d8}}})); if ($this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('product-sku') != null && $this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('product-sku') != "") { $this->{$this->x8a->x28c2->{$this->x15->x28c2->x29fa}} = $this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('googletrustedstores_gts_gs_product_id'); $this->{$this->xdd->x28c9->{$this->x15->x28c9->x301a}} = $this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('googletrustedstores_gts_country'); $this->{$this->x15->x28c2->{$this->x15->x28c2->x2a0c}} = $this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('googletrustedstores_gts_gts_id'); $this->{$this->xdd->x28c9->x3036} = $this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('googletrustedstores_gts_badge_position'); $this->{$this->x8a->x28c2->{$this->x15->x28c2->{$this->x15->x28c2->{$this->x8a->x28c2->x2a2a}}}} = $this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('googletrustedstores_gts_language'); $this->{$this->x8a->x28c2->{$this->x8a->x28c2->x2a37}} = $this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('googletrustedstores_gts_gb_id'); $this->{$this->xdd->x28c2->{$this->x8a->x28c2->{$this->x8a->x28c2->x2a4c}}} = $this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('googletrustedstores_gts_badge_container_css'); } else { $this->{$this->x15->x28c9->x300d} = ${$this->xdd->x28c9->x30b7}->{$this->x8a->x28c2->x2df6}("\x67\x6fogl\x65\164\x72us\164ed\x73\x74\157\162e\x73\57gt\163\57g\163\137pr\x6fd\x75\143\164\x5f\151d"); $this->{$this->xdd->x28c9->{$this->x15->x28c9->x301a}} = ${$this->xdd->x28c2->{$this->x8a->x28c2->{$this->x8a->x28c2->x2ab2}}}->{$this->x8a->x28c2->x2df6}("g\157og\154\x65t\x72us\x74\x65dst\157\162\x65\x73\57\x67\x74\x73\57\143o\165n\164\x72\171"); $this->{$this->x15->x28c2->{$this->xdd->x28c2->{$this->x8a->x28c2->x2a10}}} = ${$this->x15->x28c9->{$this->xdd->x28c9->x30ba}}->{$this->x8a->x28c2->x2df6}("\147\x6f\157\147\x6c\145\164\x72\165\163t\x65\x64\x73t\157\x72\x65\163\57\x67t\x73\x2f\147\x74\163_\151\x64"); $this->{$this->xdd->x28c2->{$this->xdd->x28c2->{$this->x8a->x28c2->x2a1f}}} = ${$this->xdd->x28c9->x30b7}->{$this->x8a->x28c2->x2df6}("\x67\x6f\157\147\154e\164\x72\165\x73\x74e\144\x73\x74\157\162e\x73/\147\x74s\x2f\x62\141dg\145\137\160\157\163\x69tio\156"); $this->{$this->x8a->x28c2->{$this->x15->x28c2->{$this->x15->x28c2->{$this->x8a->x28c2->x2a2a}}}} = ${$this->xdd->x28c2->{$this->x15->x28c2->x2aae}}->{$this->x8a->x28c2->x2df6}("\147\x6fog\154\x65\164ru\163\164\145d\x73\164\x6f\162\x65s/\147\164\163/\154\141n\147ua\147\145"); $this->{$this->x8a->x28c2->{$this->x8a->x28c2->{$this->x15->x28c2->{$this->xdd->x28c2->x2a3f}}}} = ${$this->xdd->x28c2->{$this->x8a->x28c2->{$this->xdd->x28c2->{$this->x15->x28c2->x2ab3}}}}->{$this->x8a->x28c2->x2df6}("\147\157\157g\x6c\x65\164\162\165\x73\164e\144\x73\x74\157r\145s\57\147\164s\57g\142\x5f\151d"); $this->{$this->xdd->x28c2->{$this->xdd->x28c2->x2a4b}} = ${$this->xdd->x28c2->x2aa9}->{$this->x8a->x28c2->x2df6}("\x67\157\157\x67\154et\x72\165\x73\164\x65\144s\164or\x65s\x2f\147\x74s\x2f\x62\141\x64g\145\137con\x74a\151\x6ee\162\137c\x73s"); } if (${$this->x8a->x28c9->x30bc}->${$this->x15->x28c9->{$this->xdd->x28c9->{$this->xdd->x28c9->{$this->xdd->x28c9->x30d0}}}} != $x286e(${$this->x8a->x28c2->{$this->xdd->x28c2->x2ac3}})) { $this->{$this->xdd->x28c2->{$this->x15->x28c2->x2a1a}} = __(${$this->x15->x28c9->{$this->xdd->x28c9->x30bd}}->${$this->xdd->x28c2->{$this->x15->x28c2->x2ace}}); } ${$this->x8a->x28c2->x2ae6} = $this->{$this->xdd->x28c9->{$this->x15->x28c9->x320d}}(); if (isset(${$this->xdd->x28c9->{$this->x8a->x28c9->{$this->x15->x28c9->x30f8}}}) && !empty(${$this->xdd->x28c2->{$this->x8a->x28c2->{$this->xdd->x28c2->{$this->x8a->x28c2->x2aed}}}})) { if ($this->{$this->x15->x28c9->x300d} != "") { $this->{$this->x15->x28c9->{$this->x8a->x28c9->x3008}} = $this->{$this->x15->x28c9->x300d}; ${$this->xdd->x28c9->{$this->xdd->x28c9->x3106}} = $this->{$this->x8a->x28c2->{$this->x15->x28c2->x29bc}}->{$this->x8a->x28c2->x2e6c}("\147\145\164\x5f".$this->{$this->x8a->x28c2->{$this->x15->x28c2->x29fa}}); $this->{$this->x8a->x28c2->{$this->x15->x28c2->x29f2}} = ${$this->x15->x28c9->x30f1}->${$this->x8a->x28c2->{$this->x8a->x28c2->x2af5}}(); } } elseif ($this->{$this->x8a->x28c2->{$this->xdd->x28c2->{$this->x8a->x28c2->{$this->xdd->x28c2->x2a6d}}}} !== false) { $this->{$this->xdd->x28c9->x3007} = $this->{$this->x8a->x28c2->{$this->xdd->x28c2->{$this->x8a->x28c2->{$this->xdd->x28c2->x2a6d}}}}; } ${$this->x8a->x28c2->{$this->x8a->x28c2->{$this->x15->x28c2->x2ac6}}} = $x286e($x2857()); $this->${$this->x8a->x28c2->x2ac2} = ""; ${$this->x15->x28c9->{$this->x8a->x28c9->{$this->x15->x28c9->{$this->x8a->x28c9->x30c2}}}}->coreHelper->{$this->x15->x28c2->x2c97}(${$this->x8a->x28c9->x30bc}, ${$this->x15->x28c9->{$this->xdd->x28c9->{$this->x15->x28c9->x30cf}}}); if (${$this->x15->x28c2->x2abd}->${$this->x8a->x28c2->{$this->x8a->x28c2->{$this->x15->x28c2->x2ac6}}} != $x286e(${$this->x15->x28c9->{$this->xdd->x28c9->{$this->xdd->x28c9->{$this->x8a->x28c9->{$this->xdd->x28c9->x30d2}}}}})) { $this->{$this->xdd->x28c2->{$this->x15->x28c2->x2a1a}} = __(${$this->x15->x28c9->{$this->x8a->x28c9->{$this->x15->x28c9->{$this->x8a->x28c9->x30c2}}}}->${$this->x8a->x28c2->x2acb}); } } public function isFrontendTest() { return $this->{$this->xdd->x28c2->{$this->x15->x28c2->x29db}}->{$this->x15->x28c2->x2e8d}('gts_test_badge'); } public function getPid() { return $this->{$this->xdd->x28c9->x3007}; } public function getIdTemplate() { return $this->{$this->xdd->x28c9->{$this->x15->x28c9->x3010}}; } public function getGoogletrustedstoresGtsCountry() { return $this->{$this->x15->x28c9->x3019}; } public function getGoogletrustedstoresGtsGtsId() { return $this->{$this->x15->x28c2->{$this->xdd->x28c2->{$this->x15->x28c2->{$this->x15->x28c2->x2a11}}}}; } public function getGoogletrustedstoresGtsBadgePosition() { return $this->{$this->xdd->x28c9->x3036}; } public function getGoogletrustedstoresGtsLanguage() { return $this->{$this->x8a->x28c2->{$this->x8a->x28c2->x2a25}}; } public function getGoogletrustedstoresGtsGbId() { return $this->{$this->x8a->x28c2->{$this->x8a->x28c2->{$this->x15->x28c2->{$this->xdd->x28c2->x2a3f}}}}; } public function getGoogletrustedstoresGtsBadgeContainerCss() { return $this->{$this->xdd->x28c9->x304f}; } private function x2898() { if (!$this->{$this->xdd->x28c2->{$this->xdd->x28c2->{$this->x15->x28c2->x29e0}}}->{$this->x15->x28c2->x2e8d}('product')) { if ($this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('product-sku') != null && $this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('product-sku') != "") { $this->{$this->x8a->x28c9->x3052}->{$this->x8a->x28c2->x2ec8}($this->{$this->x8a->x28c2->{$this->xdd->x28c2->x2a54}}->{$this->xdd->x28c2->x2ed1}($this->{$this->x15->x28c2->x2cf9}()->{$this->x8a->x28c2->x2d09}('product-sku'))); if ($this->{$this->x8a->x28c9->{$this->xdd->x28c9->x3054}}->{$this->x8a->x28c2->x2eff}() == null) { $this->{$this->x8a->x28c2->{$this->xdd->x28c2->{$this->xdd->x28c2->x2a6c}}} = __("\124\x68e\x20pr\157d\165c\164\40\x64\157es\156'\164\40\145\x78\x69s\x74"); return null; } return $this->{$this->x8a->x28c9->{$this->xdd->x28c9->x3054}}; } } else { return $this->{$this->xdd->x28c2->{$this->x15->x28c2->x29db}}->{$this->x15->x28c2->x2e8d}('product'); } } } 
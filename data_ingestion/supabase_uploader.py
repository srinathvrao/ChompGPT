"""
This script uploads the data extracted in restaurant_db/ to supabase.

lat/lon to geography point would need to be calculated.
"""

import requests
import csv
from typing import List, Dict
import os
from time import sleep

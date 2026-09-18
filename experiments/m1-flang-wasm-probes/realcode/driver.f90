program driver
  use mctc_env_error, only : error_type, fatal_error, mctc_stat
  implicit none
  type(error_type), allocatable :: error

  print '(a)', "step 1: calling mctc-lib fatal_error()"
  call fatal_error(error, "Could not read input file 'coord'")
  if (allocated(error)) then
    print '(a,i0)', "step 2: error%stat    = ", error%stat
    print '(a,a)',  "step 3: error%message = ", error%message
  else
    print '(a)', "ERROR: error not allocated"
  end if
  print '(a)', "MCTC-ERROR-ROUNDTRIP-OK"
end program

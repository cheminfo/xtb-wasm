program ec
  implicit none
  character(len=32) :: a
  integer :: n
  n = command_argument_count()
  if (n >= 1) then
    call get_command_argument(1, a)
    print '(a,a)', "argv1=", trim(a)
  else
    print '(a)', "no args"
  end if
  call get_environment_variable("XTBTESTVAR", a)
  print '(a,a)', "env XTBTESTVAR=", trim(a)
  error stop 3
end program
